// local assistant placeholder
export function answerAcreMapQuestion(question: string): string {
 const q = question.toLocaleLowerCase('fr-FR');
 if (q.includes('reliquat') || q.includes('résiduel')) return 'Le reliquat est la surface restante après les lots, voies, réserves et points de collecte. Vérifiez le bilan surfacique avant validation.';
 if (q.includes('gps') || q.includes('périmètre') || q.includes('polygone')) return 'Relevez au moins trois points GPS distincts et vérifiez que le contour ne se croise pas. Corrigez les points si le polygone est invalide.';
 if (q.includes('hectare') || q.includes('surface') || q.includes('superficie')) return '1 hectare = 10 000 m². AcreMap mesure la surface à partir de la géométrie GPS.';
 if (q.includes('voie') || q.includes('voirie')) return 'Les voies réduisent la surface disponible pour les lots. Vérifiez leur largeur et le bilan surfacique.';
 if (q.includes('partage') || q.includes('propriétaire') || q.includes('agricapital')) return 'Vérifiez les pourcentages de partage, les surfaces mesurées et le propriétaire associé aux lots.';
 if (q.includes('export') || q.includes('pdf') || q.includes('dxf') || q.includes('kml') || q.includes('geojson')) return 'PDF : impression ; DXF : CAO ; Shapefile/GeoJSON : SIG ; KML : cartes ; CSV : tableaux.';
 if (q.includes('crm') || q.includes('synchron')) return 'Le CRM est la référence des propriétaires. Synchronisez les propriétaires puis publiez le plan pour transmettre les surfaces mesurées au CRM.';
 if (q.includes('lot') || q.includes('morcellement') || q.includes('parcelle')) return 'Sélectionnez la parcelle et son relevé GPS, configurez les surfaces cibles, voies et partage, puis générez et contrôlez le plan.';
 return 'Aide locale AcreMap : posez une question sur GPS, superficies, reliquats, voies, partage, exports ou synchronisation CRM. Aucune IA externe n’est appelée.';
}
