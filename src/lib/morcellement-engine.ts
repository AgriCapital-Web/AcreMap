/**
 * AcreMap — Moteur de morcellement réel.
 *
 * Calcule une géométrie exploitable à partir du périmètre GPS réellement levé :
 * voie principale, voies secondaires, réserve familiale, points de collecte,
 * lots de superficie cible et reliquats. Toutes les surfaces sont mesurées en m²
 * sur l'ellipsoïde (turf), puis les polygones sont normalisés dans un repère
 * 0..100 pour l'aperçu vectoriel.
 */
import * as turf from "@turf/turf";
import proj4 from "proj4";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { Axis, Pt } from "./partage";
import {
  TOLERANCE_M2,
  type MorcConfig,
  type PlanLot,
  type PlanResult,
  type PlanScore,
  type PlanVoie,
} from "./morcellement-v11";

type AnyPoly = Feature<Polygon | MultiPolygon>;

/* ------------------------------- helpers turf ------------------------------- */

function ringFromPts(pts: Pt[]): number[][] {
  return [...pts, pts[0]].map((p) => [p.lng, p.lat]);
}
function ptsFromCoords(coords: number[][]): Pt[] {
  const arr = coords.map(([lng, lat]) => ({ lng, lat }));
  if (arr.length > 1 && arr[0].lat === arr.at(-1)!.lat && arr[0].lng === arr.at(-1)!.lng) arr.pop();
  return arr;
}
function extractPolys(f: AnyPoly | null): Pt[][] {
  if (!f) return [];
  const g = f.geometry;
  if (g.type === "Polygon") return [ptsFromCoords(g.coordinates[0])];
  return g.coordinates.map((c) => ptsFromCoords(c[0]));
}
function featureOf(pts: Pt[]): Feature<Polygon> {
  return turf.polygon([ringFromPts(pts)]) as Feature<Polygon>;
}
function ringAreaXY(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (a && b) sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}
function planarAreaM2(points: Pt[]): number {
  return points.length < 3 ? 0 : ringAreaXY(points.map((p) => [p.lng, p.lat]));
}
function areaOf(f: AnyPoly | null): number {
  if (!f) return 0;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  return polys.reduce((sum, rings) => sum + Math.max(0, ringAreaXY(rings[0] as number[][]) -
    rings.slice(1).reduce((holes, ring) => holes + ringAreaXY(ring as number[][]), 0)), 0);
}
function intersectSafe(a: AnyPoly, b: AnyPoly): AnyPoly | null {
  try { return turf.intersect(turf.featureCollection([a, b])) as AnyPoly | null; } catch { return null; }
}
function differenceSafe(a: AnyPoly, b: AnyPoly): AnyPoly | null {
  try { return turf.difference(turf.featureCollection([a, b])) as AnyPoly | null; }
  catch { throw new Error("Échec de soustraction géométrique : plan interrompu pour éviter les chevauchements. Vérifiez le périmètre GPS."); }
}
function boxAlong(bbox: number[], axis: Axis, from: number, to: number): Feature<Polygon> {
  const [minX, minY, maxX, maxY] = bbox;
  return axis === "horizontal"
    ? turf.polygon([[[minX - 1, from], [maxX + 1, from], [maxX + 1, to], [minX - 1, to], [minX - 1, from]]])
    : turf.polygon([[[from, minY - 1], [to, minY - 1], [to, maxY + 1], [from, maxY + 1], [from, minY - 1]]]);
}

/** Découpe une tranche de `targetM2` depuis le début de l'axe. */
function sliceByArea(poly: AnyPoly, axis: Axis, targetM2: number): { cut: AnyPoly | null; rest: AnyPoly | null; area: number } {
  const bbox = turf.bbox(poly);
  const [minX, minY, maxX, maxY] = bbox;
  let lo = axis === "horizontal" ? minY : minX;
  let hi = axis === "horizontal" ? maxY : maxX;
  let best: AnyPoly | null = null;
  let bestArea = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const box = boxAlong(bbox, axis, axis === "horizontal" ? minY - 1 : minX - 1, mid);
    const inter = intersectSafe(poly, box);
    const a = areaOf(inter);
    best = inter; bestArea = a;
    if (Math.abs(a - targetM2) <= Math.max(0.5, targetM2 * 1e-6)) break;
    if (a > targetM2) hi = mid; else lo = mid;
  }
  if (!best) return { cut: null, rest: poly, area: 0 };
  return { cut: best, rest: differenceSafe(poly, best), area: bestArea };
}

/**
 * Découpe adaptative : recherche l'arête dominante du polygone courant puis
 * coupe perpendiculairement à cette arête dans le repère métrique. À chaque
 * nouveau lot, l'orientation est recalculée sur le reliquat : les limites
 * suivent donc la forme locale du terrain au lieu de répéter une grille XY.
 */
function sliceByAreaAdaptive(poly: AnyPoly, targetM2: number): { cut: AnyPoly | null; rest: AnyPoly | null; area: number } {
  const rings = poly.geometry.type === "Polygon"
    ? [poly.geometry.coordinates[0]]
    : poly.geometry.coordinates.map((part) => part[0]);
  const vertices = rings.flat();
  if (vertices.length < 4) return { cut: null, rest: poly, area: 0 };

  // Tester plusieurs orientations réellement présentes dans la géométrie, ainsi
  // que quelques angles de secours. Aucun axe n'est privilégié pour tous les lots.
  const angles: number[] = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
  // GPS surveys can contain hundreds of vertices: use the strongest boundary
  // directions only, keeping the search bounded and responsive on mobile.
  const edges = rings.flatMap((ring) => ring.slice(0, -1).map((a, i) => {
    const b = ring[i + 1];
    return { dx: b[0] - a[0], dy: b[1] - a[1], length: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  })).filter((edge) => edge.length >= 0.5).sort((a, b) => b.length - a.length);
  for (const edge of edges) {
    if (angles.length >= 16) break;
    let angle = Math.atan2(edge.dy, edge.dx) + Math.PI / 2;
    while (angle < 0) angle += Math.PI;
    while (angle >= Math.PI) angle -= Math.PI;
    if (!angles.some((existing) => {
      const delta = Math.abs(existing - angle);
      return Math.min(delta, Math.PI - delta) < Math.PI / 36;
    })) angles.push(angle);
  }

  const [minX, minY, maxX, maxY] = turf.bbox(poly);
  const reach = Math.hypot(maxX - minX, maxY - minY) * 6 + 20;
  let winner: { cut: AnyPoly; rest: AnyPoly; area: number; score: number } | null = null;

  for (const angle of angles) {
    const nx = Math.cos(angle), ny = Math.sin(angle);
    const projections = vertices.map(([x, y]) => x * nx + y * ny);
    let lo = Math.min(...projections) - 0.01;
    let hi = Math.max(...projections) + 0.01;
    let bestCut: AnyPoly | null = null;
    let bestArea = 0;

    // Bisection on this orientation, measuring the largest connected piece,
    // not the sum of disconnected slivers on opposite sides of a concavity.
    for (let i = 0; i < 56; i++) {
      const mid = (lo + hi) / 2;
      const tx = -ny, ty = nx;
      const a: [number, number] = [nx * mid + tx * reach, ny * mid + ty * reach];
      const b: [number, number] = [nx * mid - tx * reach, ny * mid - ty * reach];
      const p1: [number, number] = [a[0] - nx * reach * 3, a[1] - ny * reach * 3];
      const p2: [number, number] = [b[0] - nx * reach * 3, b[1] - ny * reach * 3];
      const clip = turf.polygon([[a, b, p2, p1, a]]) as Feature<Polygon>;
      const candidate = intersectSafe(poly, clip);
      const pieces = splitPieces(candidate).sort((p, q) => planarAreaM2(q) - planarAreaM2(p));
      const largest = pieces[0];
      const area = largest ? planarAreaM2(largest) : 0;
      if (largest && Math.abs(area - targetM2) < Math.abs(bestArea - targetM2)) {
        bestCut = featureOf(largest);
        bestArea = area;
      }
      if (area > targetM2) hi = mid; else lo = mid;
      if (Math.abs(area - targetM2) <= Math.max(0.5, targetM2 * 1e-6)) break;
    }

    if (!bestCut || bestArea <= 0) continue;
    let perimeterLength = 0;
    const cutRing = (bestCut.geometry as Polygon).coordinates[0];
    for (let i = 0; i < cutRing.length - 1; i++) {
      perimeterLength += Math.hypot(cutRing[i + 1][0] - cutRing[i][0], cutRing[i + 1][1] - cutRing[i][1]);
    }
    // Prefer area accuracy first, then compact and practical shapes. This is a
    // heuristic, not a cadastral guarantee; the output is still checked below.
    const areaError = Math.abs(bestArea - targetM2) / Math.max(1, targetM2);
    const compactness = (perimeterLength * perimeterLength) / Math.max(1, 4 * Math.PI * bestArea);
    const score = areaError * 1000 + Math.min(10, Math.max(0, compactness - 1)) * 0.18;
    if (!winner || score < winner.score) {
      const rest = differenceSafe(poly, bestCut);
      if (!rest) continue;
      winner = { cut: bestCut, rest, area: bestArea, score };
    }
  }

  if (!winner) return { cut: null, rest: poly, area: 0 };
  return { cut: winner.cut, rest: winner.rest, area: winner.area };
}

/** Découpe un site à proximité d'une voie, sans absorber les deux côtés du corridor. */
function sliceNearCoordinate(poly: AnyPoly, axis: Axis, targetM2: number, coordinate: number): { cut: AnyPoly | null; rest: AnyPoly | null; area: number } {
  const bbox = turf.bbox(poly);
  const [minX, minY, maxX, maxY] = bbox;
  const extent = axis === "horizontal" ? maxY - minY : maxX - minX;
  let lo = 0, hi = Math.max(1, extent);
  let best: AnyPoly | null = null;
  for (let i = 0; i < 60; i++) {
    const half = (lo + hi) / 2;
    const box = boxAlong(bbox, axis, coordinate - half, coordinate + half);
    const candidate = intersectSafe(poly, box);
    const area = areaOf(candidate);
    if (candidate) best = candidate;
    if (area >= targetM2) hi = half; else lo = half;
    if (Math.abs(area - targetM2) <= Math.max(0.5, targetM2 * 1e-6)) break;
  }
  const pieces = splitPieces(best).sort((a, b) => planarAreaM2(b) - planarAreaM2(a));
  if (!pieces[0]) return { cut: null, rest: poly, area: 0 };
  const selected = featureOf(pieces[0]);
  const area = planarAreaM2(pieces[0]);
  return { cut: selected, rest: differenceSafe(poly, selected), area };
}

/** Bande de largeur `widthM` positionnée à `frac` (0..1) le long de l'axe. */
function bandAt(poly: AnyPoly, axis: Axis, frac: number, widthM: number): { band: AnyPoly | null; rest: AnyPoly | null } {
  const bbox = turf.bbox(poly);
  const [minX, minY, maxX, maxY] = bbox;
  const half = widthM / 2;
  const center = axis === "horizontal" ? minY + (maxY - minY) * frac : minX + (maxX - minX) * frac;
  const box = boxAlong(bbox, axis, center - half, center + half);
  const band = intersectSafe(poly, box);
  const rest = band ? differenceSafe(poly, band) : poly;
  return { band, rest };
}

function splitPieces(f: AnyPoly | null): Pt[][] {
  return extractPolys(f).filter((p) => p.length >= 3 && Number.isFinite(planarAreaM2(p)) && planarAreaM2(p) > 0.5);
}

/* ------------------------------ normalisation ------------------------------ */

interface Norm { (pts: Pt[]): [number, number][] }

function makeNormalizer(perimeter: Pt[]): Norm {
  const ys = perimeter.map((p) => p.lat), xs = perimeter.map((p) => p.lng);
  const minY = Math.min(...ys), maxY = Math.max(...ys), minX = Math.min(...xs), maxX = Math.max(...xs);
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const scale = 100 / Math.max(w, h), offX = (100 - w * scale) / 2, offY = (100 - h * scale) / 2;
  return (pts) => pts.map((p) => [offX + (p.lng - minX) * scale, 100 - offY - (p.lat - minY) * scale] as [number, number]);
}
interface MetricProjection { definition: string; forward(point: Pt): Pt; inverse(point: Pt): Pt }
function projectionFor(perimeter: Pt[]): MetricProjection {
  const lng = perimeter.reduce((s, p) => s + p.lng, 0) / perimeter.length;
  const lat = perimeter.reduce((s, p) => s + p.lat, 0) / perimeter.length;
  const zone = Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1));
  const definition = `+proj=utm +zone=${zone}${lat < 0 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
  return {
    definition,
    forward: (p) => { const [x, y] = proj4("EPSG:4326", definition, [p.lng, p.lat]); return { lng: x, lat: y }; },
    inverse: (p) => { const [lngOut, latOut] = proj4(definition, "EPSG:4326", [p.lng, p.lat]); return { lng: lngOut, lat: latOut }; },
  };
}

/* --------------------------------- moteur --------------------------------- */

function resolveAxis(cfg: MorcConfig, perimeter: Pt[]): Axis {
  if (cfg.orientation === "verticale") return "vertical";
  if (cfg.orientation === "horizontale") return "horizontal";
  const xs = perimeter.map((p) => p.lng), ys = perimeter.map((p) => p.lat);
  return Math.max(...ys) - Math.min(...ys) >= Math.max(...xs) - Math.min(...xs) ? "horizontal" : "vertical";
}

const perpendicular = (a: Axis): Axis => (a === "horizontal" ? "vertical" : "horizontal");

function bornesFor(code: string, poly: Pt[]) {
  return poly.map((p, i) => ({ label: `${code}-B${i + 1}`, lat: p.lat, lng: p.lng }));
}

export interface EngineInput {
  perimeter: Pt[];
  config: MorcConfig;
}

/** Construit un plan réel à partir d'un périmètre GPS levé. */
export function buildPlan({ perimeter, config: cfg }: EngineInput): PlanResult {
  const cleanPerimeter = perimeter.filter((p, i, pts) =>
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180 &&
    (i === 0 || p.lat !== pts[i - 1].lat || p.lng !== pts[i - 1].lng),
  );
  if (cleanPerimeter.length > 3 && cleanPerimeter[0].lat === cleanPerimeter.at(-1)!.lat && cleanPerimeter[0].lng === cleanPerimeter.at(-1)!.lng) cleanPerimeter.pop();
  if (cleanPerimeter.length < 3) throw new Error("Le relevé doit contenir au moins trois points GPS distincts.");
  const originalPerimeter = cleanPerimeter;
  const projection = projectionFor(originalPerimeter);
  const metricPerimeter = originalPerimeter.map(projection.forward);
  perimeter = metricPerimeter;
  const source = featureOf(metricPerimeter);
  if (!turf.booleanValid(source)) throw new Error("Le périmètre GPS est invalide ou se croise. Corrigez les points du relevé.");
  const totalM2 = planarAreaM2(metricPerimeter);
  if (!Number.isFinite(totalM2) || totalM2 <= 1) throw new Error("La superficie du périmètre est nulle ou invalide.");
  if (!Number.isFinite(cfg.cibleHa) || cfg.cibleHa <= 0) throw new Error("La superficie cible doit être strictement positive.");
  if (cfg.voiePrincipale && (!Number.isFinite(cfg.largeurVoieM) || cfg.largeurVoieM <= 0)) throw new Error("La largeur de la voie principale doit être positive.");
  if (cfg.voiesSecondaires && cfg.nbVoiesSec > 0 && (!Number.isFinite(cfg.largeurVoieSecM) || cfg.largeurVoieSecM <= 0)) throw new Error("La largeur des voies secondaires doit être positive.");
  const norm = makeNormalizer(perimeter);
  const toGeo = (points: Pt[]) => points.map(projection.inverse);
  const toBornes = (code: string, points: Pt[]) => bornesFor(code, toGeo(points));
  const cibleM2 = Math.max(1, cfg.cibleHa * 10_000);
  const axis = resolveAxis(cfg, perimeter);

  const lots: PlanLot[] = [];
  const voies: PlanVoie[] = [];
  let working: AnyPoly | null = featureOf(perimeter);
  let mainRoadAxis: Axis | null = null;
  let mainRoadCoordinate: number | null = null;

  // --- Voie principale ---------------------------------------------------
  if (cfg.voiePrincipale && working) {
    const voieAxis: Axis = cfg.orientationVoie === "verticale" ? "vertical"
      : cfg.orientationVoie === "horizontale" ? "horizontal"
      : perpendicular(axis);
    const frac = cfg.positionVoie === "laterale" ? 0.15
      : cfg.positionVoie === "centrale" || cfg.positionVoie === "traversante" ? 0.5 : 0.35;
    const roadBox = turf.bbox(working);
    mainRoadAxis = voieAxis;
    mainRoadCoordinate = voieAxis === "horizontal"
      ? roadBox[1] + (roadBox[3] - roadBox[1]) * frac
      : roadBox[0] + (roadBox[2] - roadBox[0]) * frac;
    const { band, rest } = bandAt(working, voieAxis, frac, cfg.largeurVoieM);
    for (const p of splitPieces(band)) {
      voies.push({ kind: "principale", largeurM: cfg.largeurVoieM, poly: norm(p), geo: toGeo(p) });
    }
    if (rest) working = rest;
  }

  // --- Voies secondaires --------------------------------------------------
  if (cfg.voiesSecondaires && cfg.nbVoiesSec > 0 && working) {
    const secAxis: Axis = cfg.orientationVoieSec === "verticale" ? "vertical"
      : cfg.orientationVoieSec === "horizontale" ? "horizontal"
      : axis;
    for (let i = 1; i <= cfg.nbVoiesSec; i++) {
      if (!working) break;
      const frac = i / (cfg.nbVoiesSec + 1);
      const { band, rest } = bandAt(working, secAxis, frac, cfg.largeurVoieSecM);
      for (const p of splitPieces(band)) {
        voies.push({ kind: "secondaire", largeurM: cfg.largeurVoieSecM, poly: norm(p), geo: toGeo(p) });
      }
      if (rest) working = rest;
    }
  }

  // --- Réserve familiale --------------------------------------------------
  if (cfg.reserveActive && cfg.reserveM2 > 0 && working) {
    const { cut, rest } = sliceByArea(working, axis, Math.min(cfg.reserveM2, areaOf(working) * 0.5));
    const pieces = splitPieces(cut).sort((a, b) => planarAreaM2(b) - planarAreaM2(a));
    if (pieces[0]) {
      const g = pieces[0];
      const a = planarAreaM2(g);
      lots.push({
        code: "RES", part: "proprietaire", kind: "reserve",
        poly: norm(g), geo: toGeo(g), bornes: toBornes("RES", g),
        cibleM2: cfg.reserveM2, reelM2: Math.round(a), conforme: Math.abs(a - cfg.reserveM2) <= TOLERANCE_M2,
        label: `RÉSERVE ${cfg.familleNom.toUpperCase()} — ${(a / 10000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ha`,
      });
    }
    if (rest) working = rest;
  }

  // --- Points de collecte -------------------------------------------------
  if (cfg.collecteActive && working) {
    cfg.collecte.slice(0, cfg.nbCollecte).forEach((pc) => {
      if (!working) return;
      const siteTarget = Math.min(pc.areaM2, areaOf(working) * 0.2);
      const site = cfg.optim.positionCollecte && mainRoadAxis !== null && mainRoadCoordinate !== null
        ? sliceNearCoordinate(working, mainRoadAxis, siteTarget, mainRoadCoordinate)
        : sliceByArea(working, perpendicular(axis), siteTarget);
      const { cut, rest } = site;
      const pieces = splitPieces(cut).sort((a, b) => planarAreaM2(b) - planarAreaM2(a));
      if (pieces[0]) {
        const g = pieces[0];
        const a = planarAreaM2(g);
        lots.push({
          code: pc.id, part: "ac", kind: "collecte",
          poly: norm(g), geo: toGeo(g), bornes: toBornes(pc.id, g),
          cibleM2: pc.areaM2, reelM2: Math.round(a), conforme: Math.abs(a - pc.areaM2) <= TOLERANCE_M2,
          label: `${pc.type === "principal" ? "PC PRINCIPAL" : "PC SECONDAIRE"} — ${Math.round(a).toLocaleString("fr-FR")} m²`,
        });
      }
      if (rest) working = rest;
    });
  }

  // --- Lots de superficie cible ------------------------------------------
  const utiles: PlanLot[] = [];
  const blocs = splitPieces(working).sort((a, b) => planarAreaM2(b) - planarAreaM2(a));
  const residuels: Pt[][] = [];

  for (const bloc of blocs) {
    let rem: AnyPoly | null = featureOf(bloc);
    let guard = 0;
    while (rem && guard < 10_000) {
      guard++;
      const remArea = areaOf(rem);
      if (remArea < cibleM2 + 1) break;
      const { cut, rest, area } = sliceByAreaAdaptive(rem, cibleM2);
      const pieces = splitPieces(cut).sort((a, b) => planarAreaM2(b) - planarAreaM2(a));
      if (!pieces[0]) break;
      const g = pieces[0];
      const reel = Math.round(planarAreaM2(g));
      const code = `H${String(utiles.length + 1).padStart(2, "0")}`;
      utiles.push({
        code, part: "proprietaire", kind: "lot",
        poly: norm(g), geo: toGeo(g), bornes: toBornes(code, g),
        cibleM2, reelM2: reel,
        conforme: Math.abs(reel - cibleM2) <= TOLERANCE_M2,
      });
      // Les morceaux détachés par un découpage concave rejoignent les résiduels.
      pieces.slice(1).forEach((p) => residuels.push(p));
      rem = rest;
      if (Math.abs(area - cibleM2) > cibleM2 * 0.5) break;
    }
    splitPieces(rem).forEach((p) => residuels.push(p));
  }

  // --- Partage AC / Propriétaire -----------------------------------------
  if (cfg.partageActif && utiles.length) {
    const ordered = cfg.organisationPartage === "blocs" ? [...utiles] : [...utiles].sort((a, b) => a.code.localeCompare(b.code));
    const pct = Math.max(0, Math.min(100, Number.isFinite(cfg.partAcPct) ? cfg.partAcPct : 0));
    const targetAcM2 = ordered.reduce((sum, lot) => sum + lot.reelM2, 0) * pct / 100;
    let cumulative = 0, bestCount = 0, bestError = Math.abs(targetAcM2);
    for (let i = 0; i < ordered.length; i++) {
      cumulative += ordered[i].reelM2;
      const error = Math.abs(cumulative - targetAcM2);
      if (error < bestError) { bestError = error; bestCount = i + 1; }
    }
    ordered.forEach((lot, i) => { lot.part = i < bestCount ? "ac" : "proprietaire"; });
  }

  lots.push(...utiles);

  // --- Reliquats ----------------------------------------------------------
  residuels
    .filter((p) => planarAreaM2(p) > 0.5)
    .sort((a, b) => planarAreaM2(b) - planarAreaM2(a))
    .forEach((p, i) => {
      const code = `R${String(i + 1).padStart(2, "0")}`;
      const a = Math.round(planarAreaM2(p));
      lots.push({
        code, part: "proprietaire", kind: "reserve",
        poly: norm(p), geo: toGeo(p), bornes: toBornes(code, p),
        cibleM2: a, reelM2: a, conforme: true,
        label: `RELIQUAT ${code} — ${a.toLocaleString("fr-FR")} m²`,
      });
    });

  // --- Scores -------------------------------------------------------------
  const nonConformes = utiles.filter((l) => !l.conforme).length;
  const residuelM2 = residuels.reduce((s, p) => s + planarAreaM2(p), 0);
  const allocatedM2 = lots.reduce((sum, lot) => sum + (lot.geo ? planarAreaM2(lot.geo.map(projection.forward)) : 0), 0) +
    voies.reduce((sum, voie) => sum + (voie.geo ? planarAreaM2(voie.geo.map(projection.forward)) : 0), 0);
  const balanceErrorM2 = Math.round(totalM2 - allocatedM2);
  const superficies = utiles.length
    ? Math.round(100 - (nonConformes / utiles.length) * 100)
    : 0;
  const score: PlanScore = {
    superficies,
    accessibilite: cfg.voiePrincipale ? (cfg.voiesSecondaires ? 96 : 84) : 60,
    formes: Math.round(100 - Math.min(40, (residuelM2 / Math.max(1, totalM2)) * 200)),
    voies: voies.length ? Math.min(100, 70 + voies.length * 6) : 55,
    residuels: Math.round(100 - Math.min(60, (residuelM2 / Math.max(1, totalM2)) * 100 * 2)),
    global: 0,
  };
  score.global = Math.round(
    score.superficies * 0.35 + score.accessibilite * 0.2 + score.formes * 0.15 +
    score.voies * 0.15 + score.residuels * 0.15,
  );

  return {
    lots,
    voies,
    parcelle: norm(perimeter),
    parcelleGeo: originalPerimeter,
    axis,
    score,
    conforme: nonConformes === 0 && utiles.length > 0 && Math.abs(balanceErrorM2) <= TOLERANCE_M2,
    cibleM2,
    totalM2: Math.round(totalM2),
    allocatedM2: Math.round(allocatedM2),
    balanceErrorM2,
    projection: projection.definition,
    computationToleranceM2: TOLERANCE_M2,
    createdAt: Date.now(),
  };
}
