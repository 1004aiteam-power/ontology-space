# 디지털 트윈: 가상 대한민국 전력망

웹페이지: [twin.html](https://1004aiteam-power.github.io/ontology-space/twin.html)

> ⚠ **가상 데이터입니다.** 발전소·변전소·선로·용량·부하·태양광 곡선은 모두 학습용으로 만든 가상 데이터이며,
> 실제 한국전력 계통이나 특정 설비와 무관합니다. 지도 위 위치는 지역 감각을 위해 도시 근처에 대략 배치했습니다.

## 1. 무엇을 보여 주나

대한민국 지도 위에 가상 전력망(발전소, 765kV · 345kV · 154kV 선로, 변전소)을 그리고,
하루 24시간 동안 수요와 태양광이 바뀔 때 **전압, 선로 부하율, 전력 흐름 방향, 발전 구성**이 어떻게 변하는지 재생합니다.
현실을 본뜬 가상 세계라는 점에서 [피지컬 AI 페이지](../physical-ai.html)의 '매트릭스'를 전력망에 적용한 예입니다.

| 시각 | 볼거리 |
|---|---|
| 04시 | 최저 수요. 원전·석탄이 바탕, LNG는 거의 쉼 |
| 12시 | 태양광 최대. 호남 태양광 전력이 북쪽으로 몰려 호남 선로 혼잡 (최대 부하율 약 103%) |
| 14시 | 최대 수요 48 GW. 수도권으로 향하는 간선 흐름 최대 |
| 19시 | 태양광이 사라지며 LNG가 빠르게 증가 |
| 12~13시 제주 | 태양광이 남아 HVDC로 제주 → 육지 역송(최대 400 MW), 그래도 넘쳐 태양광 출력제한(90 MW) |

## 2. 만드는 과정

```
가상 설비 목록 → pycim CIM 모델 → pandapower → 24시간 조류계산 → assets/data/twin.json → 지도
```

| CIM 클래스 | 개수 |
|---|---|
| Substation | 49 |
| VoltageLevel | 76 |
| ACLineSegment | 65 |
| PowerTransformer | 27 |
| SynchronousMachine (원전·석탄·LNG) | 13 |
| PowerElectronicsConnection (태양광·풍력) | 43 |
| EnergyConsumer | 41 |
| 제주 HVDC (pandapower dcline, CIM 미포함) | 3 |

```bash
python examples/twin/build_korea_twin.py
```

- 결과: `assets/data/twin.json` (웹), `examples/twin/korea_virtual_grid.ttl` (CIM RDF, SHACL 검증 통과)
- 이 CIM 데이터는 [실습 페이지](../lab.html)에서 SPARQL로 질의하고 지식 그래프로 볼 수 있습니다.

## 3. 가정 (모두 가상)

| 항목 | 값 |
|---|---|
| 전국 최대 수요 | 48 GW (실제보다 작게 단순화) |
| 발전 설비 (육지) | 원전 16 GW · 석탄 14.5 GW · LNG 18 GW · 대규모 태양광 5.6 GW · 분산 태양광 4 GW |
| 제주 | 최대 수요 0.85 GW, LNG 0.5 GW(제주 기준 발전기) · 풍력 0.45 GW · 태양광 1.2 GW |
| 제주 HVDC | 3회선 300 · 400 · 200 MW, 역송은 #2만. 모자라면 받고, 남으면 보내고, 그래도 넘치면 태양광 출력제한. pycim에 DC 설비 클래스가 없어 pandapower dcline으로 직접 모델링 |
| 급전 | 원전 95% 일정 → 석탄 → LNG 순으로 부족분을 용량 비례 배분, 수도권 LNG가 기준 발전기 |
| 선로 | 전압 계급별 대표 정수 (2회선 1루트), 길이 = 직선 거리 × 1.2 |
| 전압 제어 | 화력·원전은 전압 유지 발전기, 345/154kV 변압기 탭 자동 조절(OLTC 흉내), 부하 역률 0.97 |
| 생략 | 양수·ESS, 고장·예비력, 제주 계통의 상세 구성, 실제 설비 데이터 |

결과: 하루 내내 전압 0.972 ~ 1.030 pu, 송전 손실 약 1.1 ~ 1.9%.

## 4. 지도 데이터

대한민국 윤곽: [Natural Earth](https://www.naturalearthdata.com/) 1:50m (퍼블릭 도메인), [world-atlas](https://github.com/topojson/world-atlas) 경유 → `examples/twin/korea_outline.geojson`
