---
title: '업무용 Node 18은 지키면서 Astro 블로그 띄우기'
description: 'Windows에서 GitHub Pages + Astro 블로그를 만들며 밟은 함정 네 가지 — Node 버전 충돌, 회사 git 설정, 액션 버전, Pages legacy 모드'
pubDate: 'Oct 26 2026'
---

개인 기술 블로그를 GitHub Pages + Astro로 만들었다. 설치 명령 자체는 몇 줄인데, 회사 업무용 PC에서 하다 보니 중간에 걸리는 지점이 꽤 있었다. 같은 환경이라면 그대로 겪을 만한 것들이라 정리해 둔다.

## 구성

- **Astro** 공식 blog 템플릿 (Astro 7.x)
- **GitHub Pages** — `아이디.github.io` 레포
- **GitHub Actions** — main에 push하면 빌드 후 자동 배포

글은 `src/content/blog/`에 마크다운으로 넣고 push만 하면 된다.

## 함정 1. 설치한 Node 24가 안 잡힌다

`winget install OpenJS.NodeJS.LTS`로 24를 깔았는데 `node -v`는 계속 `v18.20.8`이었다.

```powershell
where.exe node
# C:\Program Files\nvm\nodejs\node.exe   ← 먼저 잡힘 (nvm, 18)
# C:\Program Files\nodejs\node.exe       ← 방금 깐 24
```

예전에 nvm-windows로 18을 쓰고 있었고, PATH 순서상 nvm 쪽이 먼저였다. 보통은 `nvm use 24`로 끝나지만, **업무 프로젝트들이 18에 물려 있어서 전역 버전을 바꿀 수 없었다.** nvm은 전역 스위치라 바꾸는 순간 다른 프로젝트도 같이 바뀐다.

그래서 블로그 작업하는 터미널 창에서만 24를 앞에 끼워 넣었다.

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
node -v   # v24.x — 이 창에서만
```

창을 닫으면 원래대로 돌아오고, 다른 창은 계속 18이다. 매번 치기 귀찮으면 PowerShell 프로필에 함수로 등록해 두면 된다.

```powershell
Add-Content $PROFILE 'function node24 { $env:Path = "C:\Program Files\nodejs;" + $env:Path; node -v }'
```

참고로 실제 배포 빌드는 GitHub 서버에서 돌기 때문에 로컬 Node는 프로젝트 생성과 미리보기에만 쓰인다.

## 함정 2. 첫 커밋에 회사 이메일이 박힌다

업무 PC라 `git config --global`에 회사 이름과 이메일이 들어가 있었다. 그런데 `create-astro`의 `--git` 옵션은 프로젝트를 만들면서 **첫 커밋까지 자동으로** 해 버린다. 공개 레포 첫 커밋 작성자가 회사 메일이 되는 셈이다.

`--no-git`으로 만들고, 레포 단위(local) 설정을 먼저 넣은 뒤에 직접 `git init` 했다.

```powershell
npm create astro@latest 아이디.github.io -- --template blog --install --no-git --yes
cd 아이디.github.io
git init -b main
git config user.name "suyeon"
git config user.email "숫자ID+아이디@users.noreply.github.com"
```

이메일은 GitHub이 주는 noreply 주소를 썼다. 숫자 ID는 이렇게 확인할 수 있다.

```powershell
gh api user --jq '.id'
```

`--global`을 안 붙였기 때문에 회사 설정은 그대로 남는다.

## 함정 3. 기억 속 액션 버전은 이미 낡았다

배포 워크플로를 쓰면서 익숙한 버전(`checkout@v4`, `withastro/action@v3`)을 적었는데, 확인해 보니 셋 다 메이저 버전이 올라가 있었다.

```powershell
gh release view -R withastro/action --json tagName --jq .tagName      # v6.x
gh release view -R actions/checkout --json tagName --jq .tagName      # v7.x
gh release view -R actions/deploy-pages --json tagName --jq .tagName  # v5.x
```

메이저가 크게 뛰면 입력 옵션 이름이 바뀌었을 수도 있어서, 쓰려는 옵션이 아직 있는지도 확인했다.

```powershell
gh api repos/withastro/action/contents/action.yml -H "Accept: application/vnd.github.raw" | Select-String "node-version"
```

최종 워크플로는 이렇다.

```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: withastro/action@v6
        with:
          node-version: 24
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

## 함정 4. Pages가 legacy 모드로 켜져 있다

`아이디.github.io` 이름으로 레포를 만들면 GitHub이 Pages를 알아서 켜 준다. 그런데 이때 켜지는 방식이 **legacy(브랜치 파일을 그대로 서빙)**다.

```powershell
gh api repos/아이디/아이디.github.io/pages --jq '.build_type'
# legacy
```

이 상태면 Actions 배포와 별개로 `pages build and deployment`라는 기본 작업이 같이 돌다가 실패(X)가 찍힌다. Actions 방식으로 바꿔 주면 정리된다.

```powershell
gh api -X PUT repos/아이디/아이디.github.io/pages -f build_type=workflow
gh workflow run deploy.yml
gh run watch
```

웹에서 하려면 레포 Settings → Pages → Source를 **GitHub Actions**로 바꾸면 된다.

## 정리

| 함정 | 원인 | 해결 |
|---|---|---|
| Node 24가 안 잡힘 | nvm 경로가 PATH 앞에 있음 | 블로그 터미널에서만 PATH 앞에 24 추가 |
| 회사 이메일로 커밋 | 전역 git 설정 + 자동 첫 커밋 | `--no-git` + 레포 local 설정 + noreply 이메일 |
| 액션 버전 구버전 | 기억에 의존 | `gh release view`로 최신 확인 |
| Pages 실패 작업 | 자동 활성화가 legacy 모드 | `build_type=workflow`로 전환 |

공통점은 "회사 PC에 이미 깔려 있는 것들과 부딪힌다"는 거다. 새 도구를 깔 때 전역 설정을 바꾸기보다, 필요한 범위(터미널 창, 레포)로 좁혀서 적용하는 게 결과적으로 제일 덜 꼬였다.
