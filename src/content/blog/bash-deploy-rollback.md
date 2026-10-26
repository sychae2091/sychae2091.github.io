---
title: 'CI 전에 만든 안전망 — bash deploy / rollback 함수'
description: '버튼 배포가 생기기 전, 그리고 생긴 뒤에도 비상구로 쓰는 수동 배포·롤백 함수. 백업 이름 규칙부터 35초의 의미까지'
pubDate: 'Oct 26 2026'
tags: ['Linux', 'Bash', '배포 자동화']
draft: true
---

CI 버튼 배포를 깔기 전에 먼저 한 일은, 장비마다 **`deploy`와 `rollback` 함수**를 심는 것이었다. 손 배포를 하더라도 순서가 매번 같아야 사고가 안 나기 때문이다. CI가 다 깔린 지금도 이 함수들은 지우지 않았다. 빌드 서버가 죽었을 때의 비상구이자, 가장 빠른 롤백 경로다.

## 사용법

```bash
deploy order-api
rollback order-api
deploy-front
rollback-front
```

서비스 이름 하나만 받는다. 장비에 들어가서 기억해야 할 게 없을수록 새벽 장애 때 실수가 줄어든다.

## deploy

```bash
deploy() {
  local svc="$1"
  local dir="/opt/service/$svc"
  local jar="$svc-0.0.1-SNAPSHOT.jar"
  local src
  src=$(ls -t ~/"$jar" /tmp/"$jar" 2>/dev/null | head -1)
  [ -z "$src" ] && { echo "새 jar 없음: ~ 또는 /tmp에 올려 주세요"; return 1; }
  unzip -l "$src" >/dev/null 2>&1 || { echo "깨진 jar — 중단"; return 1; }
  sudo mv "$dir/$jar" "$dir/$jar.bak.$(date +%Y%m%d_%H%M%S)" &&
  sudo mv "$src" "$dir/$jar" &&
  sudo systemctl restart "$svc" &&
  sleep 35 &&
  systemctl is-active "$svc" &&
  echo "=== 완료 ==="
}
```

포인트는 네 가지다.

- **업로드 위치를 고정**: 홈 또는 `/tmp`. 둘 다 없으면 바로 중단한다.
- **`unzip -l`로 jar 무결성 확인**: 전송 중 잘린 jar는 재시작 후에야 터진다. 그 전에 걸러낸다.
- **백업은 앱 폴더 안에 타임스탬프로**: `xxx.jar.bak.20260826_143012`. 정렬하면 시간순이라 롤백할 때 고민할 게 없다.
- **`&&`로만 연결**: 중간에 하나라도 실패하면 거기서 멈춘다. `;`로 이었다가 실패가 묻힌 적이 있어서 이건 규칙으로 박았다.

## rollback

```bash
rollback() {
  local svc="$1"
  local dir="/opt/service/$svc"
  local jar="$svc-0.0.1-SNAPSHOT.jar"
  local bak
  bak=$(ls -t "$dir"/"$jar".bak.* 2>/dev/null | head -1)
  [ -z "$bak" ] && { echo "백업 없음 — 중단"; return 1; }
  sudo mv "$dir/$jar" "$dir/$jar.broken" &&
  sudo mv "$bak" "$dir/$jar" &&
  sudo systemctl restart "$svc" &&
  sleep 35 &&
  systemctl is-active "$svc" &&
  echo "=== 롤백 완료: $(basename "$bak") ==="
}
```

현재 jar를 지우지 않고 `.broken`으로 치워 둔다. 롤백한 뒤에 "뭐가 문제였는지" 봐야 하니까.

프론트는 같은 구조를 디렉터리 단위로 한다. `dist`를 `dist.bak.<일시>`로 옮기고 새 tar를 풀고, 롤백은 최신 `dist.bak`을 `dist`로 되돌린다.

## 35초의 의미

`sleep 35`는 Spring Boot 앱이 올라오는 데 걸리는 시간을 재서 정한 값이다. 이 숫자는 운영팀과 공유하는 숫자이기도 하다. "라이브 배포 시 약 35초 순단"이라고 미리 안내할 수 있으니까. 기다리지 않고 바로 `is-active`를 보면 아직 `activating`이라 판단을 못 한다.

## 함수를 어디에 두나

```bash
mkdir -p ~/.bashrc.d
vi ~/.bashrc.d/myapp-deploy.sh
echo 'for f in ~/.bashrc.d/*.sh; do . "$f"; done' >> ~/.bashrc
```

여러 프로젝트가 같이 사는 공용 장비에선 **파일 이름을 프로젝트별로 분리**했다. 같은 이름의 `deploy` 함수가 두 번 정의되면 나중에 읽힌 쪽이 이긴다. 엉뚱한 경로에 배포되는 사고를 피하려면 함수 이름이나 파일을 프로젝트 단위로 나누는 게 맞다.

## 환경마다 경로가 다르면 함수도 다르게

같은 서비스여도 환경마다 설치 경로가 조금씩 달랐다(어떤 환경은 한 단계 더 깊은 폴더). 함수를 하나로 만들고 분기하는 것보다 **환경마다 그 환경 경로가 박힌 함수를 심는 쪽**을 택했다. 장비 안에서는 그 장비의 진실만 알면 된다.

## 정리

- 수동 배포라도 **순서는 코드로** 고정한다.
- 백업은 지우지 말고 **타임스탬프로 쌓는다**. 롤백은 "가장 최근 백업"이라는 단 하나의 규칙.
- CI가 생겨도 이 함수는 **비상구**로 남긴다. 빌드 서버가 죽은 날 진가가 나온다.
