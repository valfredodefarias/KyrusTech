import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ExportRowData {
  id: number;
  dataVencimento: string;
  dataPagamento?: string | null;
  interessado: string;
  descricao: string;
  categoriaNome?: string | null;
  contaNome?: string | null;
  valorAbsoluto: number;
  statusLabel: string;
  flowType: string;
}

export interface BoletimCellExportOptions {
  metricKey: string;
  cellTitle: string;
  cellSubTitle?: string;
  flowType: 'PAGAR' | 'RECEBER';
  rows: ExportRowData[];
  companyName: string;
  companyCnpj?: string | null;
  companyLogoUrl?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  centroCustoNome?: string | null;
  referenceDateIso: string;
  monthLabel: string;
  pageMode?: 'continuous' | 'paginated';
}

function formatDateBr(value?: string | null): string {
  if (!value) return '-';
  const raw = String(value).slice(0, 10);
  const parts = raw.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return value;
}

function formatCurrencyBr(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value);
}

function sanitizeFilename(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/__+/g, '_');
}

/**
 * Carrega a imagem da empresa e a converte para DataURL (Base64) de forma robusta e segura
 */
async function loadLogoDataUrl(url?: string | null, timeoutMs = 3000): Promise<string | null> {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }

  // Tentativa 1: Fetch com blob e FileReader (o método mais limpo e confiável para capturar os bytes originais)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(trimmed, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      if (dataUrl && dataUrl.startsWith('data:image/')) {
        return dataUrl;
      }
    }
  } catch {
    // Continua para tentativa 2
  }

  // Tentativa 2: Carregar via Image element + Canvas
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      let done = false;
      const t = setTimeout(() => {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, timeoutMs);
      el.onload = () => {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve(el);
        }
      };
      el.onerror = () => {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve(null);
        }
      };
      el.src = trimmed;
    });

    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL('image/png');
      }
    }
  } catch {
    // Ignora falha
  }

  return null;
}




/**
 * Exporta os lançamentos da célula clicada para Excel (.xlsx) com layout corporativo
 */
export async function exportCellToExcel(options: BoletimCellExportOptions): Promise<void> {
  const {
    cellTitle,
    cellSubTitle,
    flowType,
    rows,
    companyName,
    companyCnpj,
    userName,
    userEmail,
    centroCustoNome,
    monthLabel,
  } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kyrus ERP';
  workbook.lastModifiedBy = userName || userEmail || 'Kyrus ERP';
  workbook.created = new Date();

  const sheetName = sanitizeFilename(cellTitle).slice(0, 30);
  const worksheet = workbook.addWorksheet(sheetName);

  // Verifica se o relatório contém itens quitados ou se é uma métrica de pagos/recebidos
  const hasAnyPaid = rows.some((r) => Boolean(r.dataPagamento) || r.statusLabel?.toLowerCase().includes('pago'));
  const includePaymentCols = hasAnyPaid || options.metricKey.includes('pagas') || options.metricKey.includes('recebidas');

  // 1. Título e Cabeçalho Institucional
  const lastColLetter = includePaymentCols ? 'H' : 'F';
  worksheet.mergeCells(`A1:${lastColLetter}1`);
  const mainTitleCell = worksheet.getCell('A1');
  mainTitleCell.value = companyName.toUpperCase();
  mainTitleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  mainTitleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: flowType === 'PAGAR' ? 'FF9F1239' : 'FF065F46' },
  };
  mainTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 28;

  worksheet.mergeCells(`A2:${lastColLetter}2`);
  const subTitleCell = worksheet.getCell('A2');
  const flowLabel = flowType === 'PAGAR' ? 'CONTAS A PAGAR' : 'CONTAS A RECEBER';
  subTitleCell.value = `${flowLabel} • ${cellTitle.toUpperCase()} ${cellSubTitle ? `(${cellSubTitle})` : ''}`;
  subTitleCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
  subTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  subTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(2).height = 22;

  // 2. Metadados de Auditoria
  const nowStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());

  worksheet.addRow([]);
  const metaRow1 = worksheet.addRow([
    'Competência:',
    monthLabel,
    'Centro de Custo:',
    centroCustoNome || 'Todos os Centros de Custo',
  ]);
  metaRow1.font = { name: 'Calibri', size: 10 };
  metaRow1.getCell(1).font = { name: 'Calibri', size: 10, bold: true };
  metaRow1.getCell(3).font = { name: 'Calibri', size: 10, bold: true };

  const metaRow2 = worksheet.addRow([
    'Emitido por:',
    userName || userEmail || 'Usuário do Sistema',
    'Data/Hora:',
    `${nowStr} (Horário de Brasília)`,
    'Total Registros:',
    rows.length,
  ]);
  metaRow2.font = { name: 'Calibri', size: 10 };
  metaRow2.getCell(1).font = { name: 'Calibri', size: 10, bold: true };
  metaRow2.getCell(3).font = { name: 'Calibri', size: 10, bold: true };
  metaRow2.getCell(5).font = { name: 'Calibri', size: 10, bold: true };

  worksheet.addRow([]);

  // 3. Tabela de Lançamentos
  const headers = includePaymentCols
    ? ['Vencimento', 'Pagamento', 'Interessado / Entidade', 'Descrição', 'Categoria (Plano)', 'Conta / Banco', 'Valor (R$)', 'Status']
    : ['Vencimento', 'Interessado / Entidade', 'Descrição', 'Categoria (Plano)', 'Valor (R$)', 'Status'];

  const headerRow = worksheet.addRow(headers);
  headerRow.height = 24;

  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  let totalValor = 0;

  rows.forEach((row, index) => {
    const val = Number(row.valorAbsoluto || 0);
    totalValor += val;

    const rowData = includePaymentCols
      ? [
          formatDateBr(row.dataVencimento),
          row.dataPagamento ? formatDateBr(row.dataPagamento) : '-',
          row.interessado || '-',
          row.descricao || '-',
          row.categoriaNome || '-',
          row.contaNome || '-',
          val,
          row.statusLabel || '-',
        ]
      : [
          formatDateBr(row.dataVencimento),
          row.interessado || '-',
          row.descricao || '-',
          row.categoriaNome || '-',
          val,
          row.statusLabel || '-',
        ];

    const dataRow = worksheet.addRow(rowData);
    dataRow.height = 20;

    // Linhas zebradas suaves
    if (index % 2 === 1) {
      dataRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }

    const valColIdx = includePaymentCols ? 7 : 5;
    const valCell = dataRow.getCell(valColIdx);
    valCell.numFmt = '"R$"#,##0.00;[Red]-"R$"#,##0.00';
    valCell.alignment = { horizontal: 'right', vertical: 'middle' };

    dataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    if (includePaymentCols) {
      dataRow.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    }
    dataRow.getCell(includePaymentCols ? 8 : 6).alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Linha de Totalizador
  const totalRowData = includePaymentCols
    ? ['TOTAL GERAL', '', '', '', '', `${rows.length} itens`, totalValor, '']
    : ['TOTAL GERAL', '', '', `${rows.length} itens`, totalValor, ''];

  const totalRow = worksheet.addRow(totalRowData);
  totalRow.height = 24;
  totalRow.font = { name: 'Calibri', size: 10, bold: true };
  totalRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  const totalValIdx = includePaymentCols ? 7 : 5;
  totalRow.getCell(totalValIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  totalRow.getCell(totalValIdx).numFmt = '"R$"#,##0.00;[Red]-"R$"#,##0.00';
  totalRow.getCell(totalValIdx).alignment = { horizontal: 'right', vertical: 'middle' };

  // Ajuste automático de largura de colunas
  worksheet.columns.forEach((column) => {
    let maxLen = 14;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = cell.value ? String(cell.value).length : 10;
      if (len > maxLen) maxLen = len;
    });
    column.width = Math.min(maxLen + 4, 45);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fileName = `${flowType === 'PAGAR' ? 'CAP' : 'CAR'}_${sanitizeFilename(cellTitle)}_${options.referenceDateIso}.xlsx`;
  a.download = fileName;
  a.click();
  window.URL.revokeObjectURL(url);
}

/**
 * Exporta os lançamentos da célula clicada para um PDF Formal e Corporativo
 * em orientação Paisagem (Landscape / Widescreen), com logo da empresa, branding KyrusTECH,
 * dados do emissor, data/hora e grid detalhada. Oculta colunas desnecessárias para contas em aberto.
 */
export async function exportCellToPdf(options: BoletimCellExportOptions): Promise<void> {
  const {
    cellTitle,
    cellSubTitle,
    flowType,
    rows,
    companyName,
    companyCnpj,
    companyLogoUrl,
    userName,
    userEmail,
    centroCustoNome,
    monthLabel,
  } = options;

  const pageMode = options.pageMode || 'continuous';
  const pageWidth = 297; // A4 Widescreen em mm
  const margin = 14;
  const rightX = pageWidth - margin;

  const nowStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());

  // 1. Determina se exibe colunas de pagamento (somente se houver quitados)
  const hasAnyPaid = rows.some((r) => Boolean(r.dataPagamento) || r.statusLabel?.toLowerCase().includes('pago'));
  const includePaymentCols = hasAnyPaid || options.metricKey.includes('pagas') || options.metricKey.includes('recebidas');

  // 2. Estrutura dos dados da tabela
  const tableHeaders = includePaymentCols
    ? ['Vencimento', 'Pagamento', 'Interessado / Entidade', 'Descrição', 'Categoria', 'Conta / Banco', 'Valor (R$)', 'Status']
    : ['Vencimento', 'Interessado / Entidade', 'Descrição', 'Categoria (Plano)', 'Valor (R$)', 'Status'];

  const tableData = rows.map((r) => {
    if (includePaymentCols) {
      return [
        formatDateBr(r.dataVencimento),
        r.dataPagamento ? formatDateBr(r.dataPagamento) : '-',
        r.interessado || '-',
        r.descricao || '-',
        r.categoriaNome || '-',
        r.contaNome || '-',
        formatCurrencyBr(Number(r.valorAbsoluto || 0)),
        r.statusLabel || '-',
      ];
    }
    return [
      formatDateBr(r.dataVencimento),
      r.interessado || '-',
      r.descricao || '-',
      r.categoriaNome || '-',
      formatCurrencyBr(Number(r.valorAbsoluto || 0)),
      r.statusLabel || '-',
    ];
  });

  const columnStylesConfig: Record<string | number, any> = includePaymentCols
    ? {
        0: { halign: 'center', cellWidth: 22 }, // Vencimento
        1: { halign: 'center', cellWidth: 22 }, // Pagamento
        2: { halign: 'left', cellWidth: 50 },   // Interessado
        3: { halign: 'left', cellWidth: 65 },   // Descricao
        4: { halign: 'left', cellWidth: 38 },   // Categoria
        5: { halign: 'left', cellWidth: 28 },   // Conta
        6: { halign: 'right', cellWidth: 24, fontStyle: 'bold' }, // Valor
        7: { halign: 'center', cellWidth: 20 }, // Status
      }
    : {
        0: { halign: 'center', cellWidth: 24 }, // Vencimento
        1: { halign: 'left', cellWidth: 65 },   // Interessado
        2: { halign: 'left', cellWidth: 85 },   // Descricao
        3: { halign: 'left', cellWidth: 45 },   // Categoria
        4: { halign: 'right', cellWidth: 28, fontStyle: 'bold' }, // Valor
        5: { halign: 'center', cellWidth: 22 }, // Status
      };

  const totalVal = rows.reduce((acc, r) => acc + Number(r.valorAbsoluto || 0), 0);
  const footData = includePaymentCols
    ? [['TOTAL GERAL', '', '', '', '', `${rows.length} lançamentos`, formatCurrencyBr(totalVal), '']]
    : [['TOTAL GERAL', '', '', `${rows.length} lançamentos`, formatCurrencyBr(totalVal), '']];

  // 3. Configuração dos estilos e opções da tabela para medição e renderização
  const continuousTableOptions: any = {
    startY: 60, // header (35mm) + espaçamento (25mm)
    margin: { left: margin, right: margin, bottom: 5 },
    head: [tableHeaders],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: [30, 41, 59], // slate-800
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'center',
      cellPadding: 2.5,
    },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      textColor: [30, 41, 59],
      cellPadding: 2.2,
      overflow: 'linebreak',
    },
    columnStyles: columnStylesConfig,
    alternateRowStyles: {
      fillColor: [248, 250, 252], // slate-50
    },
    foot: footData,
    footStyles: {
      fillColor: [226, 232, 240], // slate-200
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'center',
    },
  };

  // 4. Pré-cálculo da altura exata para PDF Contínuo (Folha Única)
  // Medição idêntica com margem de segurança para impedir 100% qualquer quebra de página
  let exactPageHeight = 210;
  if (pageMode === 'continuous') {
    const dummyDoc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [pageWidth, 4500],
    });

    autoTable(dummyDoc, continuousTableOptions);

    const finalTableY = (dummyDoc as any).lastAutoTable?.finalY || 180;
    // Folga de 25mm para acomodar o rodapé com folga sem jamais atingir o margin.bottom de 5mm
    exactPageHeight = Math.max(210, Math.ceil(finalTableY + 25));
  }

  // 5. Criação do documento jsPDF definitivo com dimensões exatas desde a origem
  const orientation = pageMode === 'continuous'
    ? (pageWidth >= exactPageHeight ? 'landscape' : 'portrait')
    : 'landscape';

  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: pageMode === 'continuous' ? [pageWidth, exactPageHeight] : 'a4',
  });

  const pageHeight = doc.internal.pageSize.getHeight();

  // 5. Carrega a imagem da empresa de forma robusta em DataURL
  let companyLogoDataUrl: string | null = null;
  if (companyLogoUrl) {
    companyLogoDataUrl = await loadLogoDataUrl(companyLogoUrl, 3000);
  }

  // --- CABEÇALHO CORPORATIVO ---
  let headerY = 12;

  // Lado Esquerdo: Logo da Empresa + Nome (sem CNPJ na amostra conforme solicitado)
  if (companyLogoDataUrl) {
    try {
      const format = companyLogoDataUrl.startsWith('data:image/jpeg') || companyLogoDataUrl.startsWith('data:image/jpg') ? 'JPEG' : 'PNG';
      doc.addImage(companyLogoDataUrl, format, margin, headerY, 14, 14, undefined, 'FAST');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text(companyName, margin + 18, headerY + 9);
    } catch {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42);
      doc.text(companyName, margin, headerY + 9);
    }
  } else {
    doc.setFillColor(30, 41, 59); // slate-800
    doc.roundedRect(margin, headerY, 13, 13, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(255, 255, 255);
    const initial = companyName.trim().charAt(0).toUpperCase() || 'E';
    doc.text(initial, margin + 4.8, headerY + 9);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text(companyName, margin + 18, headerY + 9);
  }

  // Lado Direito: Identidade KyrusTECH (Apenas texto tipográfico)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const kyrusWidth = doc.getTextWidth('Kyrus ');
  const techWidth = doc.getTextWidth('TECH');
  const fullBrandWidth = kyrusWidth + techWidth;
  const startBrandX = rightX - fullBrandWidth;

  doc.setTextColor(15, 23, 42); // slate-900
  doc.text('Kyrus ', startBrandX, headerY + 6);
  doc.setTextColor(37, 99, 235); // blue-600
  doc.text('TECH', startBrandX + kyrusWidth, headerY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139); // slate-500
  const subBrand = 'Inteligência Financeira ERP';
  const subBrandWidth = doc.getTextWidth(subBrand);
  doc.text(subBrand, rightX - subBrandWidth, headerY + 11);

  // Linha separadora do cabeçalho
  headerY += 18;
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.6);
  doc.line(margin, headerY, rightX, headerY);

  // --- BANNER DO RECORTE & METADADOS (3 SEÇÕES) ---
  headerY += 5;
  const flowColorRgb = flowType === 'PAGAR' ? [225, 29, 72] : [5, 150, 105]; // rose-600 ou emerald-600
  const flowBgRgb = flowType === 'PAGAR' ? [255, 241, 242] : [236, 253, 245]; // rose-50 ou emerald-50

  doc.setFillColor(flowBgRgb[0], flowBgRgb[1], flowBgRgb[2]);
  doc.setDrawColor(flowColorRgb[0], flowColorRgb[1], flowColorRgb[2]);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, headerY, pageWidth - margin * 2, 21, 2, 2, 'FD');

  const flowLabel = flowType === 'PAGAR' ? 'CONTAS A PAGAR' : 'CONTAS A RECEBER';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(flowColorRgb[0], flowColorRgb[1], flowColorRgb[2]);
  doc.text(`RELATÓRIO DE ${flowLabel} • ${cellTitle.toUpperCase()} ${cellSubTitle ? `(${cellSubTitle})` : ''}`, margin + 5, headerY + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105); // slate-600

  // Linha 1 de Metadados
  doc.text(`Competência: ${monthLabel}`, margin + 5, headerY + 13);
  doc.text(`Centro de Custo: ${centroCustoNome || 'Todos os Centros'}`, margin + 95, headerY + 13);
  doc.text(`Emitido por: ${userName || userEmail || 'Usuário'}`, margin + 195, headerY + 13);

  // Linha 2 de Metadados
  doc.text(`Quantidade: ${rows.length} lançamentos`, margin + 5, headerY + 18);
  doc.text(`Data de Emissão: ${nowStr} (Brasília)`, margin + 95, headerY + 18);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(flowColorRgb[0], flowColorRgb[1], flowColorRgb[2]);
  doc.text(`Total Consolidado: ${formatCurrencyBr(totalVal)}`, margin + 195, headerY + 18);

  // --- TABELA DE LANÇAMENTOS NO DOCUMENTO REAL ---
  if (pageMode === 'continuous') {
    autoTable(doc, continuousTableOptions);

    // Rodapé posicionado com base na altura real da folha contínua
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(margin, exactPageHeight - 12, rightX, exactPageHeight - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(
      `Kyrus ERP • Relatório Oficial emitido em ${nowStr} • Confidencial`,
      margin,
      exactPageHeight - 7
    );

    const docTypeLabel = 'Documento Contínuo • Folha Única';
    doc.text(docTypeLabel, rightX - doc.getTextWidth(docTypeLabel), exactPageHeight - 7);
  } else {
    // Modo tradicional paginado em folhas A4
    autoTable(doc, {
      startY: headerY + 25,
      margin: { left: margin, right: margin, bottom: 18 },
      head: [tableHeaders],
      body: tableData,
      theme: 'striped',
      headStyles: {
        fillColor: [30, 41, 59], // slate-800
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
        halign: 'center',
        cellPadding: 2.5,
      },
      styles: {
        font: 'helvetica',
        fontSize: 8,
        textColor: [30, 41, 59],
        cellPadding: 2.2,
        overflow: 'linebreak',
      },
      columnStyles: columnStylesConfig,
      alternateRowStyles: {
        fillColor: [248, 250, 252], // slate-50
      },
      foot: footData,
      footStyles: {
        fillColor: [226, 232, 240], // slate-200
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        fontSize: 8.5,
        halign: 'center',
      },
      didDrawPage: (data) => {
        const pageCount = (doc.internal as any).getNumberOfPages();
        const currentPage = data.pageNumber;

        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.4);
        doc.line(margin, pageHeight - 12, rightX, pageHeight - 12);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text(
          `Kyrus ERP • Relatório Oficial emitido em ${nowStr} • Confidencial`,
          margin,
          pageHeight - 7
        );

        const pageText = `Página ${currentPage} de ${pageCount}`;
        doc.text(pageText, rightX - doc.getTextWidth(pageText), pageHeight - 7);
      },
    });
  }

  const fileName = `${flowType === 'PAGAR' ? 'CAP' : 'CAR'}_${sanitizeFilename(cellTitle)}_${options.referenceDateIso}.pdf`;
  doc.save(fileName);
}
