# FABLE FRONTIER — Open World FPS Demo

브라우저에서 바로 실행되는 오픈 월드 FPS 데모입니다. Claude(Fable 5)가 Three.js로 제작했고,
**텍스처는 Higgsfield AI로 생성**한 뒤 수학적 심리스 보정(FFT 주기 분해 + 최소비용 컷)과
노멀맵 추출을 거쳐 PBR 머티리얼로 입혔습니다. 나머지(지형·모델·사운드)는 전부 코드 절차 생성입니다.

![월드 전경](docs/screenshot-title.png)
![전투 장면](docs/screenshot-combat.png)

## 실행 방법

정적 파일 서버만 있으면 됩니다 (ES 모듈 특성상 `file://`로는 열 수 없습니다).

```bash
# 레포 루트에서
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

GitHub Pages를 켜면 (Settings → Pages → 브랜치 선택) 바로 온라인에서 플레이할 수 있습니다.

## 조작법

| 입력 | 동작 |
|---|---|
| `W` `A` `S` `D` | 이동 |
| `Shift` | 질주 |
| `Space` | 점프 |
| 마우스 | 시점 |
| 좌클릭 | 사격 (자동 연사) |
| `R` | 재장전 |
| `Esc` | 일시정지 |

## 게임 내용

- **600×600m 절차 생성 오픈 월드** — fBm 노이즈 지형, 호수, 언덕, 눈 덮인 봉우리, 220그루의 나무(인스턴싱), 바위, 버려진 전초기지와 감시탑
- **적 드론 AI** — 플레이어를 추적하고 에너지 볼트를 발사하는 호버링 드론. 처치할수록 웨이브가 오르고 최대 동시 스폰 수가 늘어납니다
- **히트스캔 사격** — 트레이서, 총구 화염, 반동, 피격 마커, 파티클 이펙트
- **체력 재생 / 피격 비네트 / 사망·재출격 루프**
- **절차 생성 사운드** — WebAudio로 합성한 총성·타격음·폭발음 (오디오 파일 없음)
- **낮 하늘 + 태양 그림자** — Three.js Sky 셰이더, 플레이어를 따라다니는 섀도 카메라
- **AI 생성 PBR 텍스처 7종** (Higgsfield) — 잔디/암벽/모래/콘크리트/수피/침엽/건메탈.
  지형은 잔디·암벽·모래·눈을 경사와 고도로 혼합하는 커스텀 스플랫 셰이더
  (`MeshStandardMaterial.onBeforeCompile`)로 렌더링하고, 각 재질의 노멀맵도 같은 가중치로 블렌딩합니다

## 기술 스택

- [Three.js](https://threejs.org/) r165 (`lib/`에 번들, CDN 의존 없음)
- 순수 ES 모듈 — 빌드 도구, 프레임워크, npm 설치 전부 불필요
- 전체 게임 로직: `src/main.js` 단일 파일

## 파일 구조

```
index.html          게임 페이지 + HUD + 오버레이
src/main.js         게임 전체 (지형, AI, 사격, 파티클, 오디오)
assets/textures/    Higgsfield AI 생성 PBR 텍스처 (basecolor + normal × 7종)
lib/                Three.js 번들
docs/               스크린샷
```
