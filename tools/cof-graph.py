#!/usr/bin/env python3
"""cof-graph — entity co-occurrence graph over the COF corpus.

Nodes are normalised entities (normalise-entities.py, so the six spellings of
Guénon are one node). An edge joins two entities that appear in the same aula,
weighted by the number of aulas they share.

WHAT AN EDGE MEANS, AND WHAT IT DOES NOT. An edge says: in N of Olavo's
lectures, these two names are both among that lecture's distinctive proper
nouns. It is a NAVIGATIONAL SIGNAL about what he discusses together. It is NOT
a claim that the two people met, corresponded, agreed, influenced one another
or belong to the same movement — a lecture that attacks A for misreading B puts
A and B on the same edge, and so does a list of names read out in passing. Every
graph of this kind reads as a social network at a glance and is not one. Treat
an edge as "read these lectures next", never as evidence about the world.

Output is GraphML and DOT — standard formats every graph tool reads (Gephi,
Cytoscape, yEd, networkx, Graphviz). No bespoke format and no plotting
dependency: this tool emits files and prints a summary, and something else
draws them.

Agent-side analysis tooling: Python 3 stdlib only, never runs in CI, READ-ONLY —
it writes only to the output paths you name, and refuses paths inside a dataset
or the corpus.
"""

import argparse
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CAVEAT = ("Co-occurrence in a lecture is NOT a relationship between the "
          "people: it means Olavo names both in the same aula. A navigational "
          "signal about what he discusses together, not evidence about the "
          "world.")
PROVENANCE = ("Derived from archive/cof/index.json `entities` (a mechanical "
              "distinctiveness ranking, not a reading of the lectures) by "
              "core/tools/cof-graph.py. Re-runnable and deterministic.")
_loaded = {}


def ne():
    if "normalise_entities" not in _loaded:
        path = os.path.join(HERE, "normalise-entities.py")
        spec = importlib.util.spec_from_file_location("normalise_entities",
                                                      path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _loaded["normalise_entities"] = module
    return _loaded["normalise_entities"]


# --------------------------------------------------------------------------
# graph construction
# --------------------------------------------------------------------------


def build_graph(groups, min_cooccurrence=1):
    """(nodes, edges) with edges weighted by shared aulas.

    Deterministic: nodes sorted by match key, edges by (source, target).
    """
    by_aula = {}
    nodes = {}
    for group in groups:
        nodes[group["key"]] = {
            "key": group["key"], "label": group["display"],
            "label2": group["label"] or "", "docs": group["docs"],
            "variants": group["variants"], "aulas": group["aulas"],
            "mergedBy": "+".join(group["mergedBy"])}
        for aula in group["aulas"]:
            by_aula.setdefault(aula, []).append(group["key"])
    weights = {}
    for aula in sorted(by_aula):
        keys = sorted(set(by_aula[aula]))
        for i, a in enumerate(keys):
            for b in keys[i + 1:]:
                pair = (a, b)
                entry = weights.setdefault(pair, [])
                entry.append(aula)
    edges = [{"source": a, "target": b, "weight": len(aulas),
              "aulas": aulas}
             for (a, b), aulas in sorted(weights.items())
             if len(aulas) >= min_cooccurrence]
    return nodes, edges


def degrees(nodes, edges):
    """{key: (degree, weighted degree)} over the surviving edges."""
    out = dict((key, [0, 0]) for key in nodes)
    for edge in edges:
        for end in (edge["source"], edge["target"]):
            out[end][0] += 1
            out[end][1] += edge["weight"]
    return dict((k, tuple(v)) for k, v in out.items())


def components(nodes, edges):
    """Connected components as sorted key lists, largest first.

    Plain BFS over an adjacency map — no library, and stable ordering so two
    runs produce the same report.
    """
    adjacency = dict((key, set()) for key in nodes)
    for edge in edges:
        adjacency[edge["source"]].add(edge["target"])
        adjacency[edge["target"]].add(edge["source"])
    seen = set()
    found = []
    for key in sorted(nodes):
        if key in seen:
            continue
        queue, group = [key], []
        seen.add(key)
        while queue:
            current = queue.pop()
            group.append(current)
            for other in sorted(adjacency[current]):
                if other not in seen:
                    seen.add(other)
                    queue.append(other)
        found.append(sorted(group))
    found.sort(key=lambda g: (-len(g), g[0]))
    return found


# --------------------------------------------------------------------------
# emitters — standard formats only
# --------------------------------------------------------------------------


def xml_escape(text):
    return (str(text).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def to_graphml(nodes, edges, order):
    """GraphML 1.0 (graphdrawing.org). Attributes are declared, then used."""
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
           "<!-- %s -->" % xml_escape(CAVEAT),
           "<!-- %s -->" % xml_escape(PROVENANCE),
           '<key id="label" for="node" attr.name="label" attr.type="string"/>',
           '<key id="aliasLabel" for="node" attr.name="aliasLabel" '
           'attr.type="string"/>',
           '<key id="aulas" for="node" attr.name="aulas" attr.type="int"/>',
           '<key id="variants" for="node" attr.name="variants" '
           'attr.type="int"/>',
           '<key id="aulaIds" for="node" attr.name="aulaIds" '
           'attr.type="string"/>',
           '<key id="weight" for="edge" attr.name="weight" attr.type="int"/>',
           '<key id="sharedAulas" for="edge" attr.name="sharedAulas" '
           'attr.type="string"/>',
           '<graph id="cof-entities" edgedefault="undirected">']
    for key in order:
        node = nodes[key]
        out.append('<node id="%s">' % xml_escape(key))
        out.append('<data key="label">%s</data>' % xml_escape(node["label"]))
        if node["label2"]:
            out.append('<data key="aliasLabel">%s</data>'
                       % xml_escape(node["label2"]))
        out.append('<data key="aulas">%d</data>' % node["docs"])
        out.append('<data key="variants">%d</data>' % node["variants"])
        out.append('<data key="aulaIds">%s</data>'
                   % xml_escape(",".join(node["aulas"])))
        out.append("</node>")
    for i, edge in enumerate(edges):
        out.append('<edge id="e%d" source="%s" target="%s">'
                   % (i, xml_escape(edge["source"]), xml_escape(edge["target"])))
        out.append('<data key="weight">%d</data>' % edge["weight"])
        out.append('<data key="sharedAulas">%s</data>'
                   % xml_escape(",".join(edge["aulas"])))
        out.append("</edge>")
    out.append("</graph>")
    out.append("</graphml>")
    return "\n".join(out) + "\n"


def dot_escape(text):
    return str(text).replace("\\", "\\\\").replace('"', '\\"') \
        .replace("\n", " ")


def to_dot(nodes, edges, order):
    """Graphviz DOT. Labels are display strings; ids are the match keys."""
    out = ["// %s" % CAVEAT, "// %s" % PROVENANCE, "graph cof_entities {"]
    for key in order:
        node = nodes[key]
        label = node["label"]
        if node["label2"] and node["label2"] != label:
            label = "%s (%s)" % (label, node["label2"])
        out.append('  "%s" [label="%s", aulas=%d, variants=%d];'
                   % (dot_escape(key), dot_escape(label), node["docs"],
                      node["variants"]))
    for edge in edges:
        out.append('  "%s" -- "%s" [weight=%d, label="%d"];'
                   % (dot_escape(edge["source"]), dot_escape(edge["target"]),
                      edge["weight"], edge["weight"]))
    out.append("}")
    return "\n".join(out) + "\n"


PROTECTED = ("index.json", "chronology.json", "glossary.json",
             "archives.json", "glossary-terms.json")


def refuse_write_target(path, corpus_path):
    """Reason a path must not be written to, or None.

    The tools never write to a dataset or into the corpus. An output path is
    the one place this tool touches the filesystem, so it is checked rather
    than trusted: no file inside the corpus directory, no file inside a repo's
    data/ directory, no known dataset filename.
    """
    if path == "-":
        return None
    target = os.path.abspath(path)
    if os.path.basename(target) in PROTECTED:
        return "%s is a dataset/manifest filename" % os.path.basename(target)
    parent = os.path.dirname(target)
    if os.path.basename(parent) == "data":
        return "inside a repository data/ directory"
    corpus_dir = os.path.dirname(os.path.abspath(corpus_path))
    if target == corpus_dir or target.startswith(corpus_dir + os.sep):
        return "inside the corpus directory %s" % corpus_dir
    return None


def emit(text, path):
    if path == "-":
        sys.stdout.write(text)
        return "(stdout)"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------


def build_report(corpus_path, aliases, min_cooccurrence=1, drop_isolated=False,
                 top=25, components_shown=5):
    module = ne()
    index = module.load_corpus(corpus_path)
    groups = module.build_table(index, aliases)
    nodes, edges = build_graph(groups, min_cooccurrence)
    total_edges = len(build_graph(groups, 1)[1])
    degree = degrees(nodes, edges)
    isolated = sorted(k for k in nodes if degree[k][0] == 0)
    if drop_isolated:
        for key in isolated:
            del nodes[key]
        degree = degrees(nodes, edges)
    order = sorted(nodes)
    parts = components(nodes, edges)
    ranked = sorted(nodes, key=lambda k: (-degree[k][0], -degree[k][1],
                                          -nodes[k]["docs"], k))
    heaviest = sorted(edges, key=lambda e: (-e["weight"], e["source"],
                                            e["target"]))
    return {
        "corpus": corpus_path, "aliasMap": aliases.path,
        "aulas": len(index.get("docs") or []),
        "minCooccurrence": min_cooccurrence,
        "nodes": len(nodes), "edges": len(edges), "edgesBeforeCut":
            total_edges, "isolated": len(isolated),
        "droppedIsolated": bool(drop_isolated),
        "components": len(parts),
        "singletonComponents": sum(1 for p in parts if len(p) == 1),
        "largestComponents": [
            {"size": len(p),
             "members": [nodes[k]["label"] for k in
                         sorted(p, key=lambda k: (-degree[k][0],
                                                  -nodes[k]["docs"], k))[:12]]}
            for p in parts[:components_shown] if len(p) > 1],
        "topDegree": [
            {"entity": nodes[k]["label"], "key": k, "degree": degree[k][0],
             "weightedDegree": degree[k][1], "aulas": nodes[k]["docs"]}
            for k in ranked[:top]],
        "topEdges": [
            {"a": nodes[e["source"]]["label"], "b": nodes[e["target"]]["label"],
             "weight": e["weight"], "aulas": e["aulas"]}
            for e in heaviest[:top]],
        "_nodes": nodes, "_edges": edges, "_order": order,
    }


def render(report):
    out = ["# cof-graph | corpus=%s | aulas=%d | nodes=%d | edges=%d "
           "(min-cooccurrence=%d, %d before the cut) | isolated=%d%s | "
           "components=%d (%d single nodes)"
           % (report["corpus"], report["aulas"], report["nodes"],
              report["edges"], report["minCooccurrence"],
              report["edgesBeforeCut"], report["isolated"],
              " (dropped)" if report["droppedIsolated"] else " (kept)",
              report["components"], report["singletonComponents"]),
           CAVEAT,
           "Nodes are normalised entities (%s applied); an entity absent from "
           "the corpus entity index is absent here, and that index ranks each "
           "aula's DISTINCTIVE proper nouns rather than every mention."
           % report["aliasMap"]]
    out.append("")
    out.append("## highest degree (%d) — <entity> | degree=<n> | "
               "weighted=<n> | aulas=<n>" % len(report["topDegree"]))
    for row in report["topDegree"]:
        out.append("%s | degree=%d | weighted=%d | aulas=%d"
                   % (row["entity"], row["degree"], row["weightedDegree"],
                      row["aulas"]))
    out.append("")
    out.append("## heaviest edges (%d) — pairs sharing the most aulas"
               % len(report["topEdges"]))
    for row in report["topEdges"]:
        out.append("%s -- %s | weight=%d | %s"
                   % (row["a"], row["b"], row["weight"],
                      ",".join(row["aulas"][:8])))
    out.append("")
    out.append("## largest connected components (%d of %d shown)"
               % (len(report["largestComponents"]), report["components"]))
    out.append("A component is a set of entities reachable from one another "
               "through shared aulas — a region of the course, not a school of "
               "thought.")
    for i, part in enumerate(report["largestComponents"]):
        out.append("component %d | size=%d | %s%s"
                   % (i + 1, part["size"], " · ".join(part["members"]),
                      " …" if part["size"] > len(part["members"]) else ""))
    return "\n".join(out)


def json_report(report):
    payload = dict((k, v) for k, v in report.items()
                   if not k.startswith("_"))
    payload["graph"] = {
        "nodes": [report["_nodes"][k] for k in report["_order"]],
        "edges": report["_edges"]}
    return payload


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="cof-graph.py",
        description="Entity co-occurrence graph over the COF corpus, in "
                    "GraphML and DOT. Read-only apart from the output files "
                    "you name.",
        epilog="CAVEAT, and it belongs in anything built on this: " + CAVEAT)
    ap.add_argument("--corpus", metavar="PATH",
                    help="cof/index.json or the cof/ directory "
                         "(default: <CRONOLOGIA_HOME>/archive/cof/index.json)")
    ap.add_argument("--aliases", metavar="PATH",
                    default=os.path.join(HERE, "cof-entity-aliases.json"),
                    help="alias map used to normalise the entities")
    ap.add_argument("--no-aliases", action="store_true",
                    help="fold only; ignore the committed alias map")
    ap.add_argument("--min-cooccurrence", type=int, default=1, metavar="N",
                    help="keep only edges seen in N+ aulas — the long tail of "
                         "one-off pairs is most of the graph (default 1)")
    ap.add_argument("--drop-isolated", action="store_true",
                    help="drop nodes left with no edge after the cut")
    ap.add_argument("--top", type=int, default=25, metavar="N",
                    help="how many entities and edges to rank (default 25)")
    ap.add_argument("--graphml", metavar="PATH",
                    help="write GraphML here ('-' for stdout)")
    ap.add_argument("--dot", metavar="PATH",
                    help="write Graphviz DOT here ('-' for stdout)")
    ap.add_argument("--json", action="store_true",
                    help="JSON summary plus the full node/edge lists")
    args = ap.parse_args(argv)

    if args.min_cooccurrence < 1:
        sys.stderr.write("cof-graph: --min-cooccurrence must be >= 1\n")
        return 2
    module = ne()
    corpus = module.resolve_corpus(args.corpus)
    for path in (args.graphml, args.dot):
        if not path:
            continue
        reason = refuse_write_target(path, corpus)
        if reason:
            sys.stderr.write("cof-graph: refusing to write %s: %s\n"
                             % (path, reason))
            return 2
    try:
        aliases = module.empty_aliases() if args.no_aliases \
            else module.load_aliases(args.aliases)
    except ValueError as exc:
        sys.stderr.write("cof-graph: invalid alias map: %s\n" % exc)
        return 2
    except (IOError, OSError) as exc:
        sys.stderr.write("cof-graph: alias map: %s\n" % exc)
        return 1
    try:
        report = build_report(corpus, aliases, args.min_cooccurrence,
                              args.drop_isolated, args.top)
    except (IOError, OSError, ValueError) as exc:
        sys.stderr.write("cof-graph: %s\n" % exc)
        return 1

    written = []
    try:
        if args.graphml:
            written.append(("graphml", emit(
                to_graphml(report["_nodes"], report["_edges"],
                           report["_order"]), args.graphml)))
        if args.dot:
            written.append(("dot", emit(
                to_dot(report["_nodes"], report["_edges"], report["_order"]),
                args.dot)))
    except (IOError, OSError) as exc:
        sys.stderr.write("cof-graph: %s\n" % exc)
        return 1

    out = module.write_out
    if args.json:
        payload = json_report(report)
        payload["written"] = [{"format": f, "path": p} for f, p in written]
        out(json.dumps(payload, ensure_ascii=False, indent=1))
    else:
        out(render(report))
        for fmt, path in written:
            if path != "(stdout)":
                out("wrote %s: %s" % (fmt, path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
