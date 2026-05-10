# 라이센스 해석 가이드 (License Interpretation Guide)

> ⚠️ 이 문서는 SDStudio Remote의 라이센스 적용에 대한 **저작권자(Minkyung)의 해석**을 정리한 안내문입니다.
> 법적으로 구속력 있는 조항은 [LICENSE](LICENSE) 파일의 영문 PolyForm Noncommercial 1.0.0 본문이며, 본 해석과 LICENSE 사이에 충돌이 있을 경우 **LICENSE가 우선**합니다.
> 이 문서는 한국어 사용자가 라이센스 의도를 빠르게 이해하기 위한 보조 자료입니다.

---

## 한 줄 요약

**개인이 자기 NAI 계정으로 자기 서버에 운영하는 건 환영합니다. 영리 목적으로 가져다 쓰는 건 안 됩니다.**

---

## 허용되는 일 (✅)

다음은 명시적으로 허용됩니다:

- **개인 사용**: 본인의 NAI 계정과 토큰으로 본인 서버에 설치하여 본인이 사용
- **소스 코드 열람**: 깃허브에서 코드를 보고 학습하기, 참고하기
- **Fork**: 깃허브에서 fork 버튼으로 자기 계정에 사본을 두기
- **수정**: Fork한 코드를 자신의 환경/취향에 맞게 수정 (UI 변경, 기능 추가/삭제, 버그 수정 등)
- **수정 사항을 자기 fork 저장소에 push**: 깃허브 fork에 자기가 변경한 코드 올리기
- **친구/가족과 공유**: 비상업적 범위 내에서 다른 사람도 자기 서버를 운영하도록 코드 전달
- **취미·학습·연구·교육·종교 단체** 등 비영리 사용 (PolyForm 정의 그대로)

이때 **반드시 지켜야 할 것** (PolyForm `Notices` 조항):
- 코드 사본을 받는 모든 사람에게 LICENSE 또는 그 URL을 함께 전달
- `Required Notice: Copyright Minkyung (https://github.com/danso0429)` 표시 유지

---

## 금지되는 일 (❌)

다음은 명시적으로 금지됩니다:

- **상업적 호스팅 서비스**: SDStudio Remote를 호스팅해서 사용료/구독료를 받는 SaaS 서비스화
- **회사 내부 도구로 사용**: 영리 기업의 사내 업무 도구로 배포·사용 (PolyForm은 "any noncommercial purpose"만 허용. "Your company" 정의에 따라 영리 기업 사용은 비허용)
- **유료 앱/패키지로 재포장**: 본 코드를 가져다 별도 상품으로 만들어 판매
- **광고 수익 모델에 통합**: 광고 노출이나 사용자 데이터 수집·판매를 목적으로 운영
- **저작자 표시 제거**: `Required Notice` 또는 GitHub 출처 표시를 삭제하고 자기 작품처럼 재배포
- **NovelAI 약관 위반 행위**: 다수 사용자에게 본인 NAI 토큰을 공유하는 등 NovelAI 측 약관을 위반하는 사용

---

## 모호한 경우의 해석

### Q1. Fork해서 자기 서버 돌리는데 친구가 가끔 와서 써도 되나요?
A. **네, 비상업적이면 됩니다.** 친구에게 사용료를 받지 않고, 광고 등 영리 목적이 없다면 PolyForm "Personal Uses"에 해당합니다.

### Q2. 동인 활동(취미)으로 그림 그리는 데 사용해도 되나요?
A. **네, 됩니다.** 동인 활동 자체가 영리 활동으로 발전하더라도, *SDStudio Remote 자체로* 직접 수익을 내는 게 아니면 무관합니다. 도구 사용은 비상업적입니다 (망치로 가구 만들어 팔아도 망치 라이센스와 무관한 것과 같음).

### Q3. 학교 동아리 서버에 설치해도 되나요?
A. **네, 됩니다.** PolyForm "Noncommercial Organizations" 조항에 교육 기관 사용이 명시적으로 허용됩니다.

### Q4. 회사 직원이 회사 인프라에서 개인 용도로 돌려도 되나요?
A. **회사 자원으로 운영하면 회색 지대입니다.** PolyForm은 "Your company" 사용을 비상업적으로 보지 않습니다. 안전하게는 회사 인프라가 아닌 개인 클라우드(Oracle Free Tier 등)에 설치하세요.

### Q5. 수정한 fork를 사람들에게 추천해도 되나요?
A. **네, 됩니다.** 수정한 버전을 자기 GitHub fork에 두고 다른 사람이 그걸 보고 fork하는 건 PolyForm `Distribution License`에 따라 허용됩니다. 단, LICENSE 파일과 `Required Notice` 유지 의무는 그대로입니다.

### Q6. 별도 zip 파일로 배포 사이트에 올려도 되나요?
A. **비상업적 의도라면 OK, 단 LICENSE/Required Notice 동봉 필수.** 다만 GitHub fork 형태가 더 안전합니다.

### Q7. 본인이 만든 plugin/extension을 추가해서 다시 배포해도 되나요?
A. **네, 됩니다.** PolyForm "Changes and New Works License"에 따라 수정 및 신규 작업 기반의 재배포가 허용됩니다.

### Q8. 라이센스를 바꿔서 (예: MIT로) 다시 배포해도 되나요?
A. **안 됩니다.** PolyForm은 "No Other Rights" 조항에 따라 sublicense 권한을 부여하지 않습니다. 받은 PolyForm 조건 그대로 전달해야 합니다.

---

## 원본 SDStudio (MIT) 부분

`frontend/` 디렉토리의 코드는 [Dd154663/SDStudio](https://github.com/Dd154663/SDStudio)의 fork이며, 원본은 MIT 라이센스입니다. 본 프로젝트의 PolyForm 라이센스는 **Minkyung이 추가한 변경 사항**(서버 코드, 배포 자동화, 보안 강화 등)에 적용됩니다.

원본 SDStudio 코드 자체는 여전히 MIT 라이센스 하에 있으며, 그 부분만 따로 가져다 쓰고 싶다면 원본 저장소에서 받으면 됩니다.

자세한 내용은 [LICENSE-NOTICES.md](LICENSE-NOTICES.md)를 보세요.

---

## 분쟁 해석

본 해석 문서와 LICENSE 본문 사이에 충돌이 있을 경우, **LICENSE 본문(영문 PolyForm 원문)이 법적으로 우선**합니다.

PolyForm 라이센스에 의문이 있다면 PolyForm 공식 사이트의 FAQ를 참고하세요: <https://polyformproject.org/licenses/noncommercial/1.0.0>

---

## 라이센스 변경 이력

- 2026-05-10 이전: CC BY-NC-ND 4.0
- 2026-05-10부터 (v1.4.0): **PolyForm Noncommercial 1.0.0**

CC 라이센스는 본래 글·이미지·음악 등의 **표현 저작물**용으로 설계되었고, [Creative Commons 측에서도 코드에 CC를 사용하지 말 것을 권고](https://creativecommons.org/faq/#can-i-apply-a-creative-commons-license-to-software)합니다. 또한 CC BY-NC-ND의 ND(파생물 금지) 조항이 본 프로젝트의 fork 권장 워크플로우와 충돌하므로, 코드 전용 표준 라이센스인 PolyForm Noncommercial로 변경했습니다.

이전 CC 라이센스 본문은 [LICENSE-CC-OLD](LICENSE-CC-OLD) 파일에 보존되어 있습니다.

