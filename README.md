# VV PDF Translator

PDF 원문을 왼쪽에 띄우고, 현재 보고 있는 페이지만 Gemini API로 읽어 한국어로 번역하는 브라우저 앱입니다.

## Setup

```bash
npm install
cp .env.example .env
```

로컬 실행은 `.env`에 Gemini API 키를 넣습니다.

```bash
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_MODEL=gemini-2.5-flash
PORT=3000
```

## Run

```bash
npm run dev
```

브라우저에서 `http://127.0.0.1:5173/`을 엽니다.

## How It Works

- 오른쪽 위의 `컴퓨터에서 PDF 열기`로 컴퓨터의 PDF 파일을 고릅니다.
- 페이지를 넘기면 현재 페이지만 이미지로 서버에 보내 OCR과 번역을 처리합니다.
- 번역 결과는 브라우저 `localStorage`에 저장되어 같은 페이지로 돌아오면 다시 API를 부르지 않습니다.
- `재번역`을 누르면 해당 페이지 캐시를 무시하고 새로 번역합니다.

## Deploy

Vercel 환경 변수에 `GEMINI_API_KEY`를 추가해야 배포된 앱에서 번역이 동작합니다.
선택 사항으로 `GEMINI_MODEL`을 지정할 수 있으며, 기본값은 `gemini-2.5-flash`입니다.

```bash
npx vercel
npx vercel env add GEMINI_API_KEY
npx vercel --prod
```

## Production Check

```bash
npm run build
npm run server
```

빌드된 앱은 `http://127.0.0.1:3000/`에서 열립니다.
