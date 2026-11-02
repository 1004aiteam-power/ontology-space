# CGMES 예제 데이터

## CIGRE_MV

CIGRE 중압 배전망 벤치마크를 NEPLAN에서 CGMES 2.4.15(EQ, TP, SV, DI)로 내보낸 파일입니다.

- 출처: [cimpy](https://github.com/sogno-platform/cimpy) `cimpy/examples/sampledata/CIGRE_MV`
  (커밋 `ac400d43c015afc4ac58e7e833b91fcba6f32812`)
- 라이선스: Apache License 2.0 — [LICENSE-cimpy-Apache-2.0](LICENSE-cimpy-Apache-2.0)
- 파일은 수정하지 않았습니다.

특징
- rdf:ID가 UUID가 아닌 이름(`Load7-I`, `N12`)입니다 → pycim이 UUID v5 mRID를 발급하고 원본 ID는 `Name`으로 보존합니다.
- ConnectivityNode 없이 TopologicalNode만 있는 버스-브랜치 모델입니다.
- SSH 파일이 없어 부하 값은 SV의 `SvPowerFlow`에서 가져옵니다.
- SV에 NEPLAN의 조류계산 결과가 있어, pycim → pandapower 결과와 비교할 수 있습니다.

## pycim이 만든 파일

| 파일 | 내용 |
|---|---|
| `cigre_mv.ttl` | 읽은 모델을 pycim으로 다시 내보낸 RDF (CIM100 네임스페이스) |
| `cigre_mv_SV_pycim.ttl` | pycim → pandapower로 계산한 TP + SV |
| `cigre_mv_mapping.csv` | 원본 rdf:ID ↔ 새 mRID |

다시 만들기: `python examples/import_cgmes.py`
