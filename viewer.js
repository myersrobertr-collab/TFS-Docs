(function(){
  const urlParams = new URLSearchParams(location.search);
  const file = urlParams.get("file");
  const label = urlParams.get("label") || "Document";

  const backBtn = document.getElementById("backBtn");
  const openBtn = document.getElementById("openBtn");
  const titleEl = document.getElementById("docTitle");
  const canvas = document.getElementById("pdfCanvas");
  const ctx = canvas.getContext("2d");
  const pageNumEl = document.getElementById("pageNum");
  const pageCountEl = document.getElementById("pageCount");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const searchBox = document.getElementById("searchBox");

  let pdfDoc = null;
  let pageNum = 1;
  let scale = 1.25;
  let rendering = false;
  let pending = null;

  titleEl.textContent = label;
  openBtn.onclick = () => window.open(file, "_blank", "noopener");
  backBtn.onclick = () => {
    if (history.length > 1) history.back();
    else location.href = "index.html";
  };

  // Basic render
  function renderPage(num){
    rendering = true;
    pdfDoc.getPage(num).then(function(page){
      const viewport = page.getViewport({ scale });
      canvas.width  = viewport.width;
      canvas.height = viewport.height;

      const renderCtx = { canvasContext: ctx, viewport: viewport };
      const task = page.render(renderCtx);
      return task.promise.then(()=>{
        rendering = false;
        pageNumEl.textContent = num;
        if (pending !== null) {
          const n = pending; pending = null; renderPage(n);
        }
      });
    });
  }

  function queueRender(n){
    if (rendering) pending = n;
    else renderPage(n);
  }

  function showPrev(){
    if (pageNum <= 1) return;
    pageNum--; queueRender(pageNum);
  }
  function showNext(){
    if (pageNum >= pdfDoc.numPages) return;
    pageNum++; queueRender(pageNum);
  }
  function zoomIn(){ scale = Math.min(scale + 0.15, 3.0); queueRender(pageNum); }
  function zoomOut(){ scale = Math.max(scale - 0.15, 0.6); queueRender(pageNum); }

  prevBtn.onclick = showPrev;
  nextBtn.onclick = showNext;
  zoomInBtn.onclick = zoomIn;
  zoomOutBtn.onclick = zoomOut;

  // Simple search (current page only)
  async function findOnPage(query){
    if (!query || !pdfDoc) return;
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items.map(i=>i.str).join(" ").toLowerCase();
    const hit = text.indexOf(query.toLowerCase());
    // just flash canvas border if found
    canvas.style.boxShadow = hit >= 0 ? "0 0 0 3px #22c55e inset" : "0 0 0 3px #ef4444 inset";
    setTimeout(()=>{ canvas.style.boxShadow="none"; }, 900);
  }
  searchBox.addEventListener("change", ()=>findOnPage(searchBox.value));
  searchBox.addEventListener("keypress", (e)=>{ if (e.key==="Enter") findOnPage(searchBox.value); });

  // Load PDF (via cache if offline)
  if (!file) {
    titleEl.textContent = "No file";
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js";

  pdfjsLib.getDocument(file).promise.then(function(pdf){
    pdfDoc = pdf;
    pageCountEl.textContent = pdf.numPages;
    renderPage(pageNum);
  }).catch(err=>{
    titleEl.textContent = "Unable to load PDF";
    console.error(err);
  });
})();
