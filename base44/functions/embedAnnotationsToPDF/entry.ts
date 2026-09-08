// PDF annotation and signature embedding is unavailable until every source
// document and upload destination is bound to exact tenant/patient authority.
Deno.serve(() => Response.json(
  {
    error: 'PDF annotation and signature embedding are temporarily unavailable.',
    code: 'pdf_annotation_embedding_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
