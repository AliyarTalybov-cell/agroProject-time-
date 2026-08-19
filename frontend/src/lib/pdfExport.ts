// jspdf и html2canvas вместе весят около 750 КБ — больше, чем весь остальной
// бандл. Нужны они только в момент нажатия «Выгрузить в PDF», поэтому
// подгружаются динамически, а не статическим импортом на странице реестра.
export async function loadPdfTools() {
  const [html2canvasModule, jspdfModule] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])
  return { html2canvas: html2canvasModule.default, jsPDF: jspdfModule.jsPDF }
}
