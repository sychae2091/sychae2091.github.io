---
title: '운영 서버엔 데몬을 두지 않는다 — 8개 환경 버튼 배포 구축기'
description: 'Jenkins도 러너도 없던 상태에서 두 리전, dev·QA·라이브 8개 환경을 버튼 배포로 바꾼 과정과 구조, 그리고 사고에서 배운 것들'
pubDate: 'Oct 26 2026'
tags: ['배포 자동화', 'GitLab CI', 'Gitea Actions', 'SSH']
draft: true
---

처음 상태는 단순했다. Jenkins 없음, GitLab 러너 0대. 배포는 장비에 들어가서 jar를 올리고 손으로 재시작하는 방식이었다. 서비스는 백엔드 10여 종에 프론트까지, 환경은 두 리전에 걸쳐 dev·QA·라이브. 이걸 전부 "버튼 하나"로 바꾸는 게 목표였다.

결과적으로 8개 환경의 백엔드·프론트 배포를 전부 버튼으로 전환했다. 구조를 정하면서 세운 원칙 하나가 전체 설계를 결정했다.

> **라이브 장비에는 배포용 데몬을 상주시키지 않는다.**

## 구조

러너가 라이브 장비 안에 있으면 편하다. 대신 러너 프로세스와 그 권한이 운영 서버에 상주하게 된다. 그래서 라이브는 **다른 장비의 러너가 빌드하고, SSH로 결과물만 밀어 넣는** 방식으로 갔다.

```text
[리전 A — GitLab CI]
  dev 장비 러너 ── 빌드 → 로컬 배포 (dev)
  QA 장비 러너  ── 빌드 → 로컬 배포 (QA)
               └─ 빌드 → scp + ssh → 라이브 (데몬 없음)

[리전 B — Gitea Actions]
  알파 장비 러너 1대 ── 빌드 → 로컬 배포 (알파)
                    ├─ scp + ssh → dev
                    ├─ scp + ssh → QA
                    └─ scp + ssh → 라이브
```

리전 B는 사내 GitLab에 연결할 수 없는 네트워크라 별도 Gitea를 두고 Gitea Actions를 썼다. 처음엔 장비마다 러너를 깔 계획이었는데, "러너는 한 대만, 나머지는 SSH"로 정리하면서 관리 포인트가 확 줄었다.

트레이드오프도 분명하다. **러너 장비가 죽으면 그 리전 전체 환경이 배포 불가**가 된다. 그래서 CI 이전에 만들어 둔 수동 배포·롤백 함수를 지우지 않고 비상 경로로 남겨 뒀다.

## 잡 하나가 하는 일

백엔드 기준으로 모든 환경이 같은 순서를 따른다.

1. 빌드 캐시 디렉터리가 있으면 `git pull`, 없으면 clone
2. `./mvnw clean package -DskipTests`
3. **jar 검증**: 크기가 10MB를 넘는지, `unzip -l`로 `BOOT-INF`가 들어 있는지
4. 대상 장비에서 기존 jar를 `*.bak.<타임스탬프>`로 백업
5. 새 jar 배치 → `systemctl restart` → `sleep 35` → `systemctl is-active`

```yaml
name: deploy-live
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: build-runner
    steps:
      - name: build
        run: |
          cd ~/build/$SVC && git pull && chmod +x mvnw && ./mvnw clean package -DskipTests
      - name: verify
        run: |
          JAR=target/$SVC-0.0.1-SNAPSHOT.jar
          test $(stat -c%s $JAR) -gt 10000000 && unzip -l $JAR | grep -q BOOT-INF
      - name: ship
        run: |
          scp $JAR deploy@$LIVE_HOST:/tmp/ &&
          ssh deploy@$LIVE_HOST "cd /opt/service/$SVC &&
            sudo mv $SVC-0.0.1-SNAPSHOT.jar $SVC-0.0.1-SNAPSHOT.jar.bak.\$(date +%Y%m%d_%H%M%S) &&
            sudo mv /tmp/$SVC-0.0.1-SNAPSHOT.jar . &&
            sudo systemctl restart $SVC && sleep 35 && systemctl is-active $SVC"
```

리전 A는 공용 템플릿 레포를 하나 두고 각 서비스 레포의 `.gitlab-ci.yml`은 `include` + 서비스명 변수만 갖게 했다. 서비스가 13개여도 고칠 곳은 템플릿 하나다.

## 사고에서 배운 것들

### `;` 하나가 실패를 삼켰다

프론트 배포가 "성공"으로 끝났는데 화면이 404였다. 원격 장비에서 `mkdir`가 sudo 권한 부족으로 실패했는데, 명령을 `;`로 이어 놔서 다음 명령이 그대로 실행됐고 잡은 초록불이었다. 백업으로 롤백한 뒤 **8개 환경의 모든 워크플로를 `&&` 연결로 통일**했다.

### 배포 성공 ≠ 원하는 곳에 배포됨

라이브 템플릿 첫 버전이 SSH판이 아니라 로컬 배포판으로 들어가 있었다. 잡은 성공했고, 실제로는 **러너가 있는 QA 장비에 배포**됐다. 라이브는 무변화. 그 뒤로 배포 직후 **대상 장비의 jar 수정 시각을 직접 확인**하는 걸 검증 단계에 넣었다.

### 템플릿을 고쳤으면 Retry 말고 New pipeline

GitLab에서 실패한 잡을 Retry하면 **그 파이프라인이 만들어질 때의 정의**로 다시 돈다. include한 템플릿을 고친 직후엔 반드시 새 파이프라인으로 실행해야 반영된다.

### 장비 기본 Java가 22였다

QA 장비의 시스템 기본 Java가 22라 Lombok과 충돌하면서 빌드가 깨졌다. 시스템 기본값을 바꾸는 대신 **템플릿에서 `JAVA_HOME`을 17로 명시**했다. 장비 환경에 기대지 않는 게 결국 안전하다.

### Windows에서 되던 프론트 빌드가 Linux에서 깨졌다

- `import` 경로 대소문자 불일치: Windows 파일시스템은 대소문자를 무시하니까 로컬에선 몰랐다.
- Vite(Rollup)의 리눅스 네이티브 모듈이 lockfile에 없어 설치 실패 → 없을 때만 조건부 설치.
- 첫 `npm ci`가 한참 멈춰서 → `node_modules` 재사용 + `git pull` 구조로 바꿔 2회차부터 3분대.

### 버튼은 누른 사람 권한으로 돈다

CI 잡의 clone은 **파이프라인 실행자 권한**으로 동작한다. 그룹 멤버가 아닌 사람이 버튼을 누르면 403. 배포 권한을 줄 사람은 그룹 권한부터 맞춰야 한다.

## 정리

| 결정 | 이유 |
|---|---|
| 라이브엔 러너 없음, SSH 원격 배포 | 운영 서버에 상주 프로세스·권한 최소화 |
| 리전별 러너 1대 집중 | 관리 포인트 축소 (대신 단일 장애점 → 수동 배포 함수 유지) |
| 템플릿 include | 13개 레포를 한 곳에서 수정 |
| jar 검증 + 백업 + `is-active` | 깨진 산출물 배포 방지, 즉시 롤백 가능 |
| `&&` 통일, 대상 장비 확인 | "초록불인데 실패"를 없애기 위해 |

자동화를 만드는 것보다 **자동화가 거짓말하지 않게 만드는 것**에 시간이 더 들었다.
