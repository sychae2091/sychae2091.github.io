---
title: '공용 다국어 테이블에 키를 안전하게 추가하는 법'
description: '여러 화면이 같이 쓰는 로케일 테이블에서 기존 키는 절대 건드리지 않고 신규 키만 넣는 SQL 패턴, 그리고 1,700행 추출본을 정리하며 본 것들'
pubDate: 'Dec 17 2026'
tags: ['SQL Server', 'i18n', '운영툴']
draft: false
---

운영툴 화면 문구는 DB의 로케일 테이블 하나에서 관리한다. 키 하나에 한국어·영어·중국어(간체/번체)·일본어 컬럼이 붙는 구조다. 새 화면을 만들 때마다 키를 추가하는데, 이 테이블은 **모든 화면이 같이 쓰는 공용 자원**이라 실수 하나가 다른 화면 문구를 바꿔 버린다.

## 규칙 두 개

1. **기존 키는 절대 수정하지 않는다.** `NAME`, `GRADE` 같은 키를 내 화면에 맞게 "살짝" 고치면, 그 키를 쓰는 다른 화면 열몇 개가 같이 바뀐다. 필요하면 새 키를 만든다.
2. **INSERT는 없을 때만, 트랜잭션 안에서.** 같은 스크립트를 두 번 돌려도 결과가 같아야 한다.

## 패턴

```sql
BEGIN TRAN;

INSERT INTO dbo.locale_info (locale_key, locale_ko, locale_en, locale_cn, locale_tw, locale_jp)
SELECT v.locale_key, v.ko, v.en, v.cn, v.tw, v.jp
FROM (VALUES
    (N'DELETED_COUNT',       N'삭제 수량',   N'Deleted Qty',   N'删除数量', N'刪除數量', N'削除数量'),
    (N'ADDED_COUNT',         N'추가 수량',   N'Added Qty',     N'增加数量', N'增加數量', N'追加数量'),
    (N'COUNT_AFTER_CHANGE',  N'변경 후 수량', N'Qty After',     N'变更后数量', N'變更後數量', N'変更後数量')
) AS v (locale_key, ko, en, cn, tw, jp)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.locale_info l WHERE l.locale_key = v.locale_key
);

SELECT @@ROWCOUNT AS inserted;

SELECT locale_key, locale_ko, locale_en
FROM dbo.locale_info
WHERE locale_key IN (N'DELETED_COUNT', N'ADDED_COUNT', N'COUNT_AFTER_CHANGE');
```

결과를 눈으로 확인하고 맞으면 `COMMIT TRAN;`, 이상하면 `ROLLBACK TRAN;`을 실행한다.

- **`VALUES` 테이블 생성자**: 키가 수십 개여도 INSERT 문 하나로 끝난다. 리뷰할 때 표처럼 읽힌다.
- **`WHERE NOT EXISTS`**: 이미 있는 키는 조용히 건너뛴다. 기존 값을 덮어쓸 위험이 구조적으로 없다.
- **`N'...'` 접두사**: nvarchar 컬럼에 한·중·일 문자를 넣을 땐 빠뜨리면 `?`로 깨진다.
- **`@@ROWCOUNT` 확인 후 커밋**: 3개를 넣으려 했는데 1이 나오면, 2개는 이미 있던 키다. 이름이 겹친 건지 확인한다.

## 컬럼을 추가할 때

새 언어 컬럼(예: 중국어)을 붙일 땐 `NULL` 허용으로 추가하고, 번역은 나중에 `UPDATE`로 채웠다. 번역이 늦게 와도 화면은 기본 언어로 폴백해서 안 깨진다.

```sql
ALTER TABLE dbo.locale_info ADD locale_cn NVARCHAR(255) NULL;
```

## 1,700행 추출본에서 본 것

번역 작업을 위해 테이블을 엑셀로 뽑아 보니 약 1,700행이었는데, 그대로 번역 맡기기엔 쓰레기가 많았다.

- **XSS 테스트 흔적**: 키나 값에 `<script>`가 들어간 행. 누군가 보안 점검하다 남긴 것.
- **test 행**: `test`, `test1` 같은 키.
- **같은 한국어를 공유하는 키 그룹**: "저장"이 `SAVE`, `BTN_SAVE`, `SAVE_BUTTON`…으로 여러 번.

정리 순서는 이렇게 잡았다.

1. 번역 대상에서 **테스트성 행 제외** (삭제는 사용처 확인 후)
2. 같은 한국어 그룹은 **번역을 한 번만** 받아서 일괄 적용
3. 키 통합(중복 키 제거)은 **프론트 사용처를 grep으로 전부 확인한 뒤** 별도 작업으로

번역 비용과 리스크를 줄이는 건 "덜 번역하기"에서 시작한다.
