---
title: '도메인을 바꿨더니 게시글 1,675건이 옛 주소를 보고 있었다'
description: '에디터가 저장한 HTML에 박힌 절대 URL을 안전하게 일괄 치환한 절차 — 카운트, 1건 테스트, 백업, REPLACE, 잔여 0건 확인'
pubDate: 'Nov 19 2026'
tags: ['MariaDB', 'SQL', '트러블슈팅']
draft: false
---

서비스 도메인이 바뀌었다. 옛 도메인은 곧 내려갈 예정이고, 지금은 리다이렉트 덕에 겨우 이미지가 보이는 상태. 문제는 게시판이었다. **위지윅 에디터가 본문 HTML을 저장할 때 이미지 주소를 절대 URL로 박아 넣고 있었다.**

```html
<img src="https://old.example.com/upfiles/board/2025/xxx.png">
```

옛 도메인이 죽는 순간 게시글 이미지가 전부 엑스박스가 된다.

## 원인은 두 군데

1. **애플리케이션**: 이미지 업로드 유틸이 설정 파일의 프론트 도메인 값을 경로 앞에 붙여서 반환하고 있었다. 에디터는 받은 URL을 그대로 HTML에 넣는다.
2. **데이터**: 그렇게 저장된 과거 게시글 본문들.

순서가 중요하다. **설정부터 바꿔 배포**해야 한다. 데이터를 먼저 고치면, 그 사이에 올라온 새 글이 다시 옛 도메인으로 저장된다.

## 절차

### 1. 규모 파악

```sql
SELECT COUNT(*)
FROM board
WHERE content LIKE '%old.example.com%';
```

1,675건.

### 2. 한 건으로 리허설

```sql
UPDATE board
SET content = REPLACE(content, 'https://old.example.com', 'https://new.example.com')
WHERE id = 12345;
```

실제 화면에서 그 글을 열어 이미지가 뜨는지 확인한다. SQL이 맞는 것과 화면이 맞는 건 다른 문제다. 경로 중간에 `http://`로 박힌 것, `www`가 붙은 것처럼 **변형 패턴**이 있는지도 여기서 본다.

### 3. 백업 테이블

```sql
CREATE TABLE board_bak_20260713 AS SELECT * FROM board;
SELECT COUNT(*) FROM board_bak_20260713;
```

롤백이 `UPDATE ... SET content = bak.content` 한 줄로 끝나도록 통째로 떠 둔다.

### 4. 일괄 치환

```sql
START TRANSACTION;

UPDATE board
SET content = REPLACE(content, 'https://old.example.com', 'https://new.example.com')
WHERE content LIKE '%old.example.com%';

SELECT ROW_COUNT();
```

영향 행 수가 1단계 카운트와 맞으면 `COMMIT`, 아니면 `ROLLBACK`.

### 5. 잔여 0건 확인

```sql
SELECT COUNT(*) FROM board WHERE content LIKE '%old.example.com%';
```

`0`이 나와야 끝이다.

## 다른 테이블도 본다

게시판만 있는 게 아니었다. 배너 테이블을 보니 **이미지 경로는 이미 새 도메인**이었고, 옛 도메인은 **링크 URL 컬럼에만**, 그것도 비활성 배너에만 남아 있었다. 노출되지 않는 데이터라 이번엔 건드리지 않았다. "옛 도메인이 남아 있다"와 "사용자에게 깨져 보인다"는 다르다.

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND data_type IN ('varchar', 'text', 'mediumtext', 'longtext');
```

문자열 컬럼 목록을 뽑아 놓고 하나씩 `LIKE`로 훑으면 빠뜨리는 테이블이 없다.

## 다음엔 이렇게 저장하자

| 저장 방식 | 도메인 변경 시 |
|---|---|
| 절대 URL (`https://도메인/upfiles/...`) | 데이터 전부 치환 필요 |
| 루트 상대 경로 (`/upfiles/...`) | 아무것도 안 해도 됨 |
| 저장소 키 (`board/2025/xxx.png`) + 렌더링 시 CDN 주소 결합 | 설정 한 줄 |

**DB에는 "어디에 있는지"만 저장하고, "어떤 도메인으로 보여 줄지"는 렌더링 시점에 결정**하는 게 맞다. 도메인은 생각보다 자주 바뀐다.
