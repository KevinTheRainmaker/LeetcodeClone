# Mac mini 세팅 — judge-server + Cloudflare Tunnel

연구실 Mac mini에서 채점 서버를 상시 돌리고, Cloudflare Tunnel로 HTTPS 공개해
Vercel에 배포된 프론트가 안전하게 호출할 수 있게 만듭니다.

전제: Mac mini에 Homebrew, Python3는 이미 설치되어 있다고 가정. 그 외 도구는 여기서 전부 설치합니다.

---

## 1. 빌드 도구 & 런타임 설치

```bash
# Xcode Command Line Tools (clang/clang++, git, make)
xcode-select --install
# → GUI 팝업에서 "설치" 클릭. 5~10분 소요.

# Java(JDK 17+, 채점용) + cloudflared(터널)
brew update
brew install openjdk@17 cloudflared
# Homebrew 안내에 따라 JAVA_HOME / PATH 설정:
#   echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zshrc
#   echo 'export JAVA_HOME="/opt/homebrew/opt/openjdk@17"' >> ~/.zshrc

# 버전 확인
clang++ --version   # Apple clang 14 이상
javac --version     # 17+
java --version      # 17+
python3 --version   # 3.11 권장
cloudflared --version
```

> macOS에서 `g++`는 `clang++` 심볼릭 링크이므로 별도 GCC 설치 불필요.

## 2. 프로젝트 가져오기 + 파이썬 환경

```bash
cd ~
git clone <REPO_URL> LeetcodeClone
cd LeetcodeClone/judge-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 3. 공유 토큰 생성

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
# 출력 문자열을 복사 → 아래 plist와 Vercel 환경변수에 동일하게 입력
```

## 4. launchd로 judge-server 자동 실행

> 템플릿 파일 위치: `~/LeetcodeClone/judge-server/deploy/judge-server.plist`
> (2번에서 `git clone` 했으므로 이 경로에 이미 존재합니다.)

### 4-1. 템플릿 복사

```bash
mkdir -p ~/Library/LaunchAgents
cp ~/LeetcodeClone/judge-server/deploy/judge-server.plist \
   ~/Library/LaunchAgents/com.lab.judge-server.plist
```

### 4-2. 자리표시자 치환

복사한 파일을 편집기로 열어 두 곳을 바꿉니다.

```bash
nano ~/Library/LaunchAgents/com.lab.judge-server.plist
```

- `<USERNAME>` (3군데) → Mac mini 사용자 이름. `whoami`로 확인.
- `<JUDGE_SHARED_TOKEN_VALUE>` (1군데) → 3번에서 생성한 토큰 문자열.

sed로 한 번에 치환하고 싶다면:

```bash
USER_NAME=$(whoami)
TOKEN="<3번에서_생성한_토큰>"
sed -i '' "s|<USERNAME>|$USER_NAME|g; s|<JUDGE_SHARED_TOKEN_VALUE>|$TOKEN|g" \
    ~/Library/LaunchAgents/com.lab.judge-server.plist
```

### 4-3. 로드 및 확인

```bash
launchctl load ~/Library/LaunchAgents/com.lab.judge-server.plist

curl http://127.0.0.1:8000/health        # {"status":"ok"}
curl -X POST http://127.0.0.1:8000/judge \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"problemId":1,"language":"java","code":"static int maxDepth(int[] levelOrder){return 0;}","mode":"run"}'
```

401이 나오면 토큰이 틀린 것, 403/404는 라우팅 문제, 200이면 정상.

재시작이 필요하면:

```bash
launchctl unload ~/Library/LaunchAgents/com.lab.judge-server.plist \
 && launchctl load ~/Library/LaunchAgents/com.lab.judge-server.plist
```

## 5. Cloudflare Tunnel 세팅

### 5-A. 계정과 도메인

1. https://dash.cloudflare.com/sign-up 에서 계정 생성 (무료).
2. 도메인이 있으면 Cloudflare에 네임서버 위임. 없으면 아래 Quick Tunnel(5-E)로 임시 테스트만 가능 — 운영에는 도메인 필요.

### 5-B. 로그인 & 터널 생성

```bash
cloudflared tunnel login
# → 브라우저가 열리고 Authorize 버튼 클릭. ~/.cloudflared/cert.pem 생성.

cloudflared tunnel create judge-server
# → "Tunnel ID: <UUID>" 출력. ~/.cloudflared/<UUID>.json 생성.
```

### 5-C. config.yml 작성

> 템플릿 위치: `~/LeetcodeClone/judge-server/deploy/config.yml.example`

```bash
mkdir -p ~/.cloudflared
cp ~/LeetcodeClone/judge-server/deploy/config.yml.example ~/.cloudflared/config.yml
nano ~/.cloudflared/config.yml
# ↳ <UUID>, <USERNAME>, <HOSTNAME> 3곳 치환 (5-B에서 나온 Tunnel ID + 사용하려는 도메인)
```

이어서:

```bash
cloudflared tunnel route dns judge-server judge.example.com
# → DNS CNAME 자동 생성. 도메인을 소유한 Cloudflare 계정이어야 함.

cloudflared tunnel --config ~/.cloudflared/config.yml run   # 포그라운드 테스트
```

다른 터미널에서:

```bash
curl https://judge.example.com/health                       # 토큰 불필요
curl -X POST https://judge.example.com/judge \
     -H "Authorization: Bearer <토큰>" \
     -H "Content-Type: application/json" \
     -d '{"problemId":1,"language":"java","code":"static int maxDepth(int[] levelOrder){return 0;}","mode":"run"}'
```

### 5-D. launchd로 터널 상시 실행

> 템플릿 위치: `~/LeetcodeClone/judge-server/deploy/cloudflared.plist`

```bash
cp ~/LeetcodeClone/judge-server/deploy/cloudflared.plist \
   ~/Library/LaunchAgents/com.lab.cloudflared.plist

# <USERNAME> 치환
sed -i '' "s|<USERNAME>|$(whoami)|g" \
    ~/Library/LaunchAgents/com.lab.cloudflared.plist

# cloudflared 실제 경로 확인 (Apple Silicon은 /opt/homebrew/bin, Intel은 /usr/local/bin)
which cloudflared
# 위 결과가 /opt/homebrew/bin/cloudflared와 다르면 plist의 ProgramArguments 첫 줄을 맞춰 수정:
#   nano ~/Library/LaunchAgents/com.lab.cloudflared.plist

launchctl load ~/Library/LaunchAgents/com.lab.cloudflared.plist
```

### 5-E. (옵션) 도메인 없이 Quick Tunnel 임시 테스트

```bash
cloudflared tunnel --url http://127.0.0.1:8000
# → https://xxxxx.trycloudflare.com 출력
# → 이 주소를 Vercel 환경변수 JUDGE_BASE_URL에 넣어 맛보기 테스트 가능
# → 재시작마다 도메인이 바뀌므로 운영에는 부적합.
```

## 6. Vercel 환경변수 설정

```bash
cd LeetcodeClone
vercel env add OPENROUTER_API_KEY production
vercel env add JUDGE_BASE_URL production         # https://judge.example.com
vercel env add JUDGE_SHARED_TOKEN production     # Mac mini와 동일한 토큰
vercel env add OPENROUTER_MODEL production       # (선택) 예: anthropic/claude-3.5-haiku
vercel env add OPENROUTER_REFERER production     # (선택) 예: https://<app>.vercel.app
vercel --prod
```

Preview 배포에서도 같은 값을 쓰고 싶다면 `production` 대신 `preview`로 추가.

## 7. 재부팅 검증

```bash
sudo reboot
# 부팅 후
launchctl list | grep com.lab         # 두 개 모두 PID 보여야 정상
curl https://judge.example.com/health
```

## 8. 문제 해결

- **401 Missing/Invalid bearer token**: Vercel `JUDGE_SHARED_TOKEN`과 plist 안의 토큰이 다르다. 재배포 필요.
- **502 from Vercel**: `JUDGE_BASE_URL`이 잘못되었거나 터널 다운. `curl https://judge.example.com/health` 먼저 확인.
- **CORS 에러**: 이 구성에서 브라우저는 `/api/*`(Vercel 같은 오리진)만 호출하므로 CORS 에러가 나올 리 없음. 나온다면 override(`localStorage.judgeApiBase`)가 남아있을 확률 → DevTools Application 탭에서 삭제.
- **Tunnel 죽음**: `tail -f ~/cloudflared.err`로 원인 확인. 재시작: `launchctl kickstart -k gui/$(id -u)/com.lab.cloudflared`.
- **채점 타임아웃**: `main.py`의 `TIME_LIMIT_SEC`은 2초. 서브프로세스가 무한 루프면 죽을 때까지 2초 대기. Vercel 프록시 `maxDuration`은 15초로 잡아 여유를 둠.
