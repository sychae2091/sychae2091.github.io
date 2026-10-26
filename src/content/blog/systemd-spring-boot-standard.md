---
title: 'Spring Boot jar를 systemd로 띄우는 표준형 — .service와 .conf 두 파일 세트'
description: 'jar 교체와 설정 변경을 분리하는 EnvironmentFile 패턴, 시스템 PATH에 기대지 않는 Java, 그리고 "설정 말고 실제를 보는" 검증 습관'
pubDate: 'Dec 03 2026'
tags: ['systemd', 'Linux', 'Spring Boot', 'Java']
draft: false
---

장비를 새로 세팅할 때마다 서비스 등록 방식이 조금씩 달라지는 게 싫어서 표준형을 하나 정했다. 핵심은 **앱마다 파일 두 개**다.

```text
/usr/lib/systemd/system/order-api.service   ← 어떻게 실행하나 (거의 안 바뀜)
/opt/service/order-api/order-api.conf       ← 무엇으로 실행하나 (환경마다 다름)
```

## .conf — 환경별 값

```bash
APP_ROOT=/opt/service/order-api
BINARY="order-api-0.0.1-SNAPSHOT.jar"
JAVA_OPTS="-Xms256m -Xmx512m -Dspring.profiles.active=dev -Djava.net.preferIPv4Stack=true"
```

## .service — 실행 방식

```ini
[Unit]
Description=order-api
After=network.target

[Service]
User=root
WorkingDirectory=/opt/service/order-api
EnvironmentFile=-/opt/service/order-api/order-api.conf
ExecStart=/bin/bash -c "exec /usr/local/java/bin/java $JAVA_OPTS -jar $BINARY"
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## 왜 두 파일로 나누나

- **jar 교체 = .conf를 안 건드림.** 배포 스크립트는 jar만 바꾸고 재시작한다. 힙이나 프로파일을 실수로 덮어쓸 일이 없다.
- **환경 차이는 .conf에만.** dev/QA/라이브의 `.service`는 글자 하나 다르지 않고, 차이는 전부 `.conf`에 모인다. 환경 비교가 `diff` 한 번이다.
- **`EnvironmentFile=-`의 `-`**: 파일이 없어도 서비스가 실패하지 않는다. 대신 기본값으로 뜨니까, 그걸 원치 않으면 `-`를 빼면 된다.
- **`exec`**: bash가 java로 대체되면서 systemd가 java 프로세스를 직접 관리한다. 종료 시그널이 제대로 전달된다.

## Java는 전용 경로로

```bash
sudo tar xzf OpenJDK17U-jdk_x64_linux.tar.gz -C /usr/local/
sudo ln -s /usr/local/jdk-17.0.12+7 /usr/local/java
/usr/local/java/bin/java -version
```

시스템 PATH에 올리지 않고 `/usr/local/java` 심볼릭 링크로 고정했다. 한 장비의 시스템 기본 Java가 22로 올라가 있었는데, Lombok과 충돌해서 빌드가 깨진 적이 있다. **서비스가 쓰는 Java는 서비스 설정에 명시**한다. 업그레이드는 링크만 바꾸면 된다.

## 힙은 환경별로, 합계는 장비 기준으로

| 환경 | 예시 |
|---|---|
| dev / 알파 | `-Xms128m~256m -Xmx256m~512m` |
| 라이브 운영툴 | `-Xmx2048m~5120m` |
| 램이 작은 라이브 | 위 값의 축소판 |

서비스 하나하나는 적정해 보여도, **한 장비에 10개가 넘게 뜨면 `-Xmx` 합계가 램을 넘는다.** 서비스를 추가할 때마다 장비 전체 합계를 다시 계산한다. 힙 외에 메타스페이스와 스레드 스택 몫도 있다는 걸 잊지 말자.

## 검증: 설정 말고 실제를 본다

```bash
systemctl is-active order-api
journalctl -u order-api -n 50 | grep -i "profiles are active"
```

**프로파일이 의도대로 잡혔는지**를 로그로 확인한다. `.conf`에 `product`라고 썼어도 오타 하나면 기본 프로파일로 뜬다.

```bash
sudo ss -tnp | grep 1433
```

DB 연결은 설정 파일을 읽는 대신 **실제 ESTAB 세션**이 있는지 본다. 설정이 맞아도 방화벽이 막혀 있으면 소용없다.

```bash
unzip -p order-api-0.0.1-SNAPSHOT.jar BOOT-INF/classes/application.yml | head -40
```

"이 jar에 무슨 설정이 들어갔지?"는 소스를 볼 게 아니라 **배포된 jar를 직접 열어** 본다. 빌드 시점의 설정과 소스의 현재 설정이 다를 수 있다.

## 정리

- `.service`는 "어떻게", `.conf`는 "무엇으로". 배포는 jar만 바꾼다.
- Java 경로와 프로파일은 **명시**한다. 장비의 기본값에 기대지 않는다.
- 검증은 설정 파일이 아니라 **로그·소켓·jar 내용** 같은 실제 상태로 한다.
