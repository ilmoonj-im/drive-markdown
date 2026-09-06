# Drive Markdown

개인용 iPhone/iPad Google Drive Markdown 뷰어/에디터입니다.

## 기반 프로젝트
이 패키지는 spskelly/markdown-viewer의 "작고 단순한 PWA Markdown Viewer" 구조와 MIT 라이선스를 기반으로,
Google Drive 전용 탐색/편집 흐름에 맞게 재구성한 버전입니다.

원본:
https://github.com/spskelly/markdown-viewer

## 기능

- Google 로그인
- 지정 Google Drive 폴더를 시작 폴더로 사용
- 하위 폴더 탐색
- `.md` / `.markdown` 파일만 표시
- Markdown 렌더링
- 코드 하이라이트
- 원문 편집
- 같은 Google Drive 파일에 바로 저장
- `![[Attachments/photo.jpg]]` Obsidian 이미지 임베드 지원
- `![](Attachments/photo.jpg)` 상대 이미지 지원
- iPhone/iPad Safari 홈 화면 추가(PWA)

## 배포

이 폴더의 파일을 그대로 GitHub 저장소 최상위에 업로드한 뒤 GitHub Pages를 켭니다.

예:
https://YOUR-ID.github.io/REPOSITORY/

## Google Cloud — 한 번만 설정

1. Google Cloud Console에서 프로젝트 생성
2. Google Drive API 사용 설정
3. Google Auth Platform에서 OAuth 동의 화면 구성
4. Audience를 External로 두고 본인 Google 계정을 Test user로 추가
5. OAuth Client 생성
   - Application type: Web application
6. Authorized JavaScript origins에 GitHub Pages의 origin 추가

예를 들어 앱 주소가:
https://abc.github.io/drive-md/

Authorized JavaScript origins에는:
https://abc.github.io

7. 생성된 Client ID를 복사

## 앱에서 설정

앱 우측 상단 ⚙︎ →
- Google OAuth Client ID 입력
- Google Drive 폴더 ID 입력
- 저장
- Google 로그인

폴더 주소가:
https://drive.google.com/drive/folders/1AbCdEf12345

이면 폴더 ID는:
1AbCdEf12345

폴더 URL 전체를 붙여넣어도 앱이 ID를 추출합니다.

## iPhone / iPad

Safari에서 GitHub Pages 주소를 연 뒤:
공유 → 홈 화면에 추가

## 권한

기존 Google Drive 파일을 찾아 읽고 같은 파일에 저장하기 위해 Drive OAuth scope를 사용합니다.
개인용 Google OAuth 테스트 앱으로 본인 계정만 Test user에 등록해서 쓰는 것을 전제로 합니다.

## 주의

- Client Secret은 절대 이 앱에 넣지 마세요.
- OAuth Client ID는 비밀키가 아닙니다.
- Google 로그인 access token은 메모리에만 보관하며 앱을 다시 열면 로그인이 다시 필요할 수 있습니다.
