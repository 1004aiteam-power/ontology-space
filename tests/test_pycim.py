import dataclasses
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pycim import (ACLineSegment, Breaker, BusbarSection, ConnectivityNode, EnergyConsumer,
                   Equipment, ExternalNetworkInjection, Model, PowerTransformer, Substation,
                   Switch, Terminal, VoltageLevel, to_turtle, topology)
from pycim.base import cim_property_name


def build():
    m = Model()
    a, b, c = (m.add(ConnectivityNode(name=n)) for n in "abc")
    src = m.add(ExternalNetworkInjection(name="src")).connect(a)
    cb = m.add(Breaker(name="cb")).connect(a, b)
    m.add(ACLineSegment(name="line", length=1.0)).connect(b, c)
    load = m.add(EnergyConsumer(name="load", p=1.0)).connect(c)
    return m, src, cb, load


def test_hierarchy_matches_cim():
    assert Breaker.cim_hierarchy()[:4] == ["Breaker", "ProtectedSwitch", "Switch", "ConductingEquipment"]
    assert issubclass(Breaker, Switch) and issubclass(Breaker, Equipment)


def test_cim_property_names():
    ss = Substation(name="S")
    vl = VoltageLevel(name="V", substation=ss)
    names = dict(vl.cim_properties())
    assert names["IdentifiedObject.name"] == "V"
    assert names["VoltageLevel.Substation"] is ss
    assert "IdentifiedObject.mRID" in names
    f = next(f for f in dataclasses.fields(ACLineSegment) if f.name == "length")
    assert cim_property_name(ACLineSegment, f, 1.0) == "Conductor.length"


def test_inverse_links():
    m, src, cb, load = build()
    t1, t2 = cb.terminals
    assert isinstance(t1, Terminal) and (t1.sequence_number, t2.sequence_number) == (1, 2)
    assert t1 in t1.connectivity_node.terminals
    assert topology.neighbors(cb) == [src, m.by_name("line")]


def test_outage_analysis():
    m, src, cb, load = build()
    assert topology.deenergized_loads(m, [src]) == []
    cb.open = True
    assert topology.deenergized_loads(m, [src]) == [load]


def test_model_includes_owned_objects():
    m, src, cb, load = build()
    assert len(m.of_type(Terminal)) == 6
    assert len(m) == 3 + 4 + 6


def test_transformer_ends():
    tr = PowerTransformer(name="T").connect(ConnectivityNode(), ConnectivityNode())
    e1 = tr.add_end(tr.terminals[0], rated_u=154.0)
    e2 = tr.add_end(tr.terminals[1], rated_u=22.9)
    assert tr.ends == [e1, e2] and e2.end_number == 2


def test_turtle_parses():
    rdflib = pytest.importorskip("rdflib")
    m, *_ = build()
    g = rdflib.Graph().parse(data=to_turtle(m), format="turtle")
    cim = rdflib.Namespace("http://iec.ch/TC57/CIM100#")
    assert len(list(g.subjects(rdflib.RDF.type, cim.Terminal))) == 6
    assert (None, cim["Switch.open"], rdflib.Literal(False)) in g


def test_transformer_percent():
    from pycim.export_pandapower import transformer_percent
    from pycim.samples import sample_grid
    tr = sample_grid().of_type(PowerTransformer)[0]
    vk, vkr = transformer_percent(tr)
    assert round(vk, 1) == 12.0 and round(vkr, 2) == 0.25


def test_opendss_script():
    from pycim.export_opendss import to_opendss
    from pycim.samples import sample_grid
    m = sample_grid()
    m.by_name("154kV 선로 CB").open = True
    script, names = to_opendss(m)
    assert "New Circuit.pycim basekv=154" in script
    assert script.count("switch=yes") == 2 and "Open Line.SW1 1" in script
    assert len(names) == 5


def test_pandapower_and_opendss_agree():
    pytest.importorskip("pandapower")
    pytest.importorskip("opendssdirect")
    from pycim import export_opendss, export_pandapower
    from pycim.samples import sample_grid
    m = sample_grid()
    a, b = export_pandapower.solve(m), export_opendss.solve(m)
    for cn in a:
        assert abs(a[cn] - b[cn]) < 1e-3


# ---- mRID 발급 -------------------------------------------------------------
def test_default_mrid_is_uuid4():
    import uuid
    a, b = Breaker(name="x"), Breaker(name="x")
    assert uuid.UUID(a.mrid).version == 4 and a.mrid != b.mrid


def test_stable_mrid_is_deterministic():
    import uuid
    from pycim import stable_mrid
    a = stable_mrid("SCADA", "A변전소", "CB-154-01")
    assert a == stable_mrid("SCADA", "A변전소", "CB-154-01")
    assert a != stable_mrid("SCADA", "A변전소", "CB-154-02")
    assert uuid.UUID(a).version == 5


def test_sample_grid_ids_are_reproducible():
    from pycim.samples import sample_grid
    a, b = sample_grid(), sample_grid()
    assert [o.mrid for o in a] == [o.mrid for o in b]
    assert len({o.mrid for o in a}) == len(a)          # 전부 유일


def test_terminal_and_end_ids_follow_parent():
    from pycim import stable_mrid
    tr = PowerTransformer(mrid=stable_mrid("T"), name="T").connect(ConnectivityNode(), ConnectivityNode())
    tr2 = PowerTransformer(mrid=stable_mrid("T"), name="T").connect(ConnectivityNode(), ConnectivityNode())
    assert [t.mrid for t in tr.terminals] == [t.mrid for t in tr2.terminals]
    assert tr.add_end(tr.terminals[0]).mrid == tr2.add_end(tr2.terminals[0]).mrid


def test_model_rejects_bad_or_duplicate_mrid():
    m = Model()
    with pytest.raises(ValueError):
        m.add(Breaker(mrid="CB-1"))
    m.add(Breaker(mrid="9d1f0c1e-3a55-4d9b-9a3e-2f7f2c1b0a11"))
    with pytest.raises(ValueError):
        m.add(Breaker(mrid="9d1f0c1e-3a55-4d9b-9a3e-2f7f2c1b0a11"))


def test_turtle_urn_style():
    rdflib = pytest.importorskip("rdflib")
    m, *_ = build()
    g = rdflib.Graph().parse(data=to_turtle(m, iri_style="urn"), format="turtle")
    subjects = {str(s) for s in g.subjects()}
    assert all(s.startswith("urn:uuid:") for s in subjects)
