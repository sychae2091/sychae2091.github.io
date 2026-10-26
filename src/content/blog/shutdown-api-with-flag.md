---
title: '서비스를 종료할 때 API를 바로 지우지 않는 이유 — 플래그로 DB부터 끊기'
description: '서비스 종료 작업에서 앱은 살려 두고 설정 플래그로 DB 접근만 차단한 방식. GET은 빈 데이터, POST는 종료 코드'
pubDate: 'Dec 10 2026'
tags: ['Spring Boot', '운영']
draft: false
---

서비스 종료가 결정됐다. 웹사이트를 닫고, 그 뒤에 있던 API가 DB에서 데이터를 가져오던 걸 끊어야 했다. 가장 깔끔해 보이는 방법은 **API 서버를 내리는 것**이다. 하지만 그렇게 하지 않았다.

## 바로 내리면 생기는 일

- 아직 이 API를 호출하는 곳(캐시된 프론트, 외부 연동, 잊고 있던 배치)이 **커넥션 에러나 502**를 받는다. 에러 알람이 쏟아지고, 어디서 부르는지 추적하기도 어렵다.
- 종료 직후 "이 데이터만 잠깐 다시 봐야 한다"는 요청이 오면, 다시 띄우는 데 시간이 걸린다.
- DB 쪽은 백업과 아카이빙이 진행 중이다. API가 내려가는 시점과 DB가 정리되는 시점이 꼬이면 원인 파악이 어렵다.

## 대신 이렇게 했다

**앱은 유지하고, 플래그 하나로 DB 접근만 막는다.** 안정화되면 그때 코드를 정리한다.

```yaml
service:
  closed: true
```

```java
@Component
@RequiredArgsConstructor
public class ServiceClosedInterceptor implements HandlerInterceptor {

    @Value("${service.closed:false}")
    private boolean closed;

    private final ObjectMapper objectMapper;

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) throws Exception {
        if (!closed) return true;
        res.setContentType("application/json;charset=UTF-8");
        if ("GET".equals(req.getMethod())) {
            res.getWriter().write(objectMapper.writeValueAsString(Map.of("data", List.of())));
        } else {
            res.getWriter().write(objectMapper.writeValueAsString(Map.of("code", "SERVICE_CLOSED")));
        }
        return false;
    }
}
```

- **GET → 빈 데이터.** 목록 화면은 "글이 없음"으로 자연스럽게 보인다. 프론트가 에러 처리를 몰라도 깨지지 않는다.
- **POST → 종료 코드.** 쓰기 요청은 명확하게 거절한다. 클라이언트가 이 코드를 보고 안내 문구를 띄울 수 있다.
- **컨트롤러 앞에서 막는다.** 서비스·매퍼 코드는 건드리지 않으니, 플래그를 `false`로 돌리면 즉시 원복된다.

여기에 DB 커넥션 풀을 아예 띄우지 않으려면 datasource 자동 설정을 프로파일로 분리하는 방법도 있다. 다만 단계를 나눴다. **먼저 요청 단에서 막고, 아무도 안 깨지는 걸 확인한 다음에** 코드를 지운다.

## 확인할 것

```bash
curl -s https://api.example.com/api/notices | jq .
curl -s -X POST https://api.example.com/api/inquiries -d '{}' -H 'Content-Type: application/json' | jq .
sudo ss -tnp | grep 3306
```

마지막 줄이 핵심이다. 플래그를 켠 뒤 **DB 포트로 ESTAB 세션이 남아 있지 않은지** 본다. 요청은 막았는데 스케줄러가 몰래 DB를 읽고 있을 수도 있다.

## 정리

| 단계 | 행동 | 되돌리기 |
|---|---|---|
| 1 | 플래그로 요청 차단 (GET 빈 값, POST 종료 코드) | 플래그 off |
| 2 | 로그·DB 세션 모니터링으로 아무도 안 깨지는지 확인 | — |
| 3 | 안정화 후 코드·설정·장비 정리 | 백업에서 복원 |

"끄는 것"도 배포다. **되돌릴 수 있는 순서**로 쪼개면 종료 작업도 무섭지 않다.
