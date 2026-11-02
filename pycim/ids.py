"""mRID(Master Resource Identifier) 발급 규칙.

CIM은 mRID를 "모델 관리 주체가 발급하는 식별자"로 정의하고, 전역 유일성을 위해
UUID(RFC 4122, 현재 RFC 9562) 사용을 강력히 권장한다.
mRID는 한 번 발급하면 설비가 존재하는 동안 바뀌면 안 된다.
(다시 내보낼 때마다 ID가 바뀌면 시스템 간 교환과 이력 추적이 깨진다.)

두 가지 발급 방식
  new_mrid()            UUID v4 (무작위)  : 새 설비를 처음 등록할 때
  stable_mrid(*keys)    UUID v5 (이름 기반): 기존 시스템의 설비코드처럼 이미 유일한 키가 있을 때
                         같은 키 → 항상 같은 UUID. 기존 데이터를 CIM으로 변환할 때 유용
"""
from __future__ import annotations

import uuid

# 이 프로젝트의 네임스페이스 UUID (고정값). 조직마다 자신의 값을 정해 써야 한다.
PYCIM_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/1004aiteam-power/ontology-space")


def new_mrid() -> str:
    """무작위 UUID v4."""
    return str(uuid.uuid4())


def stable_mrid(*keys: object, namespace: uuid.UUID = PYCIM_NAMESPACE) -> str:
    """키에서 결정적으로 만든 UUID v5. 예: stable_mrid("SCADA", "A변전소", "CB-154-01")"""
    return str(uuid.uuid5(namespace, "/".join(str(k) for k in keys)))


def child_mrid(parent_mrid: str, *keys: object) -> str:
    """부모 객체에 종속된 객체(Terminal, TransformerEnd)의 mRID. 부모가 같으면 항상 같다."""
    return str(uuid.uuid5(uuid.UUID(parent_mrid), "/".join(str(k) for k in keys)))


def is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except (ValueError, TypeError):
        return False
