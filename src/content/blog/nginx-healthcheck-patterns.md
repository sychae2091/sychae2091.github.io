---
title: 'nginx 헬스체크 3가지 — "장비가 살았나"와 "API가 살았나"는 다른 질문이다'
description: '로드밸런서 헬스체크를 nginx 직접 응답, API 응답, nginx 프록시 중 무엇으로 할지 고르는 기준과 nginx 세팅 때 자주 밟는 함정'
pubDate: 'Oct 26 2026'
tags: ['nginx', 'Linux', 'Spring Boot']
draft: true
---

로드밸런서에 헬스체크 경로를 등록할 때마다 같은 고민을 했다. `/health`가 200을 주면 "건강하다"는 건데, **무엇이** 건강하다는 걸까. 운영하면서 정리한 세 가지 방식이다.

## 방식 1. nginx가 직접 응답

```nginx
location = /health {
    access_log off;
    default_type text/plain;
    return 200 'OK';
}
```

- **답하는 질문**: 장비와 nginx가 살아 있나?
- **장점**: 앱이 죽어도 200. 앱 재배포 중에 LB가 장비를 빼 버리지 않는다.
- **단점**: 앱이 죽어도 200. LB는 죽은 앱으로 트래픽을 계속 보낸다.
- **쓸 때**: 장비 한 대짜리 서비스, 앱 재시작 중에도 정적 화면은 떠야 할 때.

## 방식 2. API가 응답

```java
@RestController
public class HealthController {
    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", 200);
    }
}
```

- **답하는 질문**: 애플리케이션 프로세스가 요청을 처리할 수 있나?
- **쓸 때**: LB가 API 포트를 직접 바라볼 때. DB 연결까지 보고 싶다면 Actuator의 health 엔드포인트처럼 의존성 체크를 넣을 수 있지만, **DB가 잠깐 흔들릴 때 모든 장비가 한꺼번에 빠지는** 역효과도 생각해야 한다.

## 방식 3. nginx가 API로 프록시

```nginx
upstream gateway-server {
    server 127.0.0.1:18082;
}

location = /health {
    proxy_pass http://gateway-server/health;
}
```

- **답하는 질문**: 사용자가 들어오는 경로 그대로(nginx → 앱) 살아 있나?
- **쓸 때**: LB → nginx → 앱 구조에서 **실제 사용자 경로**를 검사하고 싶을 때. 운영툴은 2 + 3 조합으로 쓴다.

## 고르는 기준

| 질문 | 방식 |
|---|---|
| 장비만 살아 있으면 된다 | 1 |
| 앱 프로세스가 살아 있어야 한다 | 2 |
| 사용자 경로 전체가 살아 있어야 한다 | 3 (+ 2) |

## nginx 세팅 때 밟았던 함정들

### IPv6 리스닝 누락

LB나 클라이언트가 IPv6로 붙는 환경에서 접속이 안 됐다. `listen 80;`만 있고 IPv6가 없었다.

```nginx
listen 80;
listen [::]:80;
```

### SELinux가 프록시를 막는다

Rocky 계열은 SELinux가 enforcing이라, nginx가 upstream 포트로 연결하는 것 자체가 막힌다. 로그엔 `502`와 `Permission denied`만 보인다.

```bash
sudo setsebool -P httpd_can_network_connect 1
```

### 무거운 쿼리는 타임아웃부터

BI처럼 수십 초짜리 쿼리가 도는 API는 기본 타임아웃(60초)에 걸려 504가 난다.

```nginx
location /api {
    proxy_pass http://api-server;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

### SPA는 새로고침 404

React/Vue 라우터 경로로 새로고침하면 404가 난다.

```nginx
location / {
    root /var/www/app/dist;
    try_files $uri $uri/ /index.html;
}
```

## 적용 전 습관

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -s -H "Host: app.example.com" http://localhost/health
```

`nginx -t`를 통과하지 못한 설정으로 reload하면, 그 순간 전체가 내려갈 수 있다. 그리고 확인은 **도메인 Host 헤더를 붙여서** 한다. server_name이 여러 개인 장비에서 `curl localhost`만 하면 엉뚱한 server 블록이 답한다.
