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
