//================================================================================
// Archivo principal para el dashboard de producción
//
// Este script gestiona la carga de datos (desde XML), el procesamiento y la
// visualización de gráficos de secuencia y medidores (gauges) en el DOM.
//================================================================================

/* ===========================================================================
   CONFIGURACIÓN GLOBAL Y VARIABLES
   =========================================================================== */

// Carga la librería de Google Charts.
google.charts.load("current", { packages: ["corechart"] });

console.log("🔴 Script cargado y ejecutándose");

// Intervalos de actualización para los diferentes tipos de visualización.
const UPDATE_INTERVALS = {
  SEQUENCE: 5000,   // 5 segundos para las gráficas de secuencia (A, B, C)
  GAUGES: 10000     // 10 segundos para los medidores de producción (A-J)
};

// URLs de los archivos de datos.
const DATA_URLS = {
  sequence: { // Datos de secuencia para máquinas específicas
    A: "datasets/test_A.xml",
    B: "datasets/test_B.xml",
    //C: "http://10.2.160.72:8081/xml"
    C: "datasets/test_C.xml"
  },
  production: "datasets/production_data.xml" // Datos de producción para todas las máquinas
};

// Objetos para almacenar el estado y los datos de la aplicación.
const machineEvents = {}; // Almacena los eventos de secuencia para A, B y C
const gauges = {};        // Almacena las instancias de los medidores (gauges)

/* ===========================================================================
   FUNCIONES AUXILIARES Y DE FORMATO
   =========================================================================== */

/**
 * Convierte una duración en formato "HH:MM:SS" a segundos.
 * @param {string} duration La duración en formato de texto.
 * @returns {number} La duración total en segundos.
 */
function parseDurationToSeconds(duration) {
  const [h, m, s] = duration.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

/**
 * Formatea una cantidad de segundos a un string "HH:MM:SS".
 * @param {number} totalSeconds La cantidad de segundos a formatear.
 * @returns {string} La duración en formato de texto.
 */
function formatSecondsToHMS(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Convierte un número decimal (ej. 1.5 horas) a formato de tiempo "HH:MM".
 * @param {number} decimal El valor decimal a convertir.
 * @returns {string} El tiempo en formato "HH:MM".
 */
function decimalToTime(decimal) {
  const hours = Math.floor(decimal);
  const minutes = Math.floor((decimal % 1) * 60);
  return `${hours}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Actualiza el elemento del DOM con la hora de la última actualización de los datos.
 * @param {string} xmlDateTime La fecha y hora en formato XML.
 */
 function displayUpdatedTime(xmlDateTime) {
   
  try {
    // Asegurar que la fecha viene en formato válido
    const date = new Date(xmlDateTime);
    
    // Validar que la fecha sea correcta
    if (isNaN(date.getTime())) {
      console.error('Fecha inválida recibida:', xmlDateTime);
      document.getElementById('update-time-value').textContent = 'Fecha no disponible';
      return;
    }

    // Formatear la fecha de manera más robusta
    const options = {
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false
    };
    
    const formattedDate = date.toLocaleString('es-ES', options);
    document.getElementById('update-time-value').textContent = formattedDate;
    
  } catch (error) {
    console.error('Error al formatear fecha:', error);
    document.getElementById('update-time-value').textContent = 'Error en fecha';
  }
}

/* ===========================================================================
   FUNCIONES DE PROCESAMIENTO DE DATOS
   =========================================================================== */

/**
 * Procesa el XML de datos de producción y extrae los valores clave para cada máquina.
 * @param {string} xmlText El string XML con los datos de producción.
 * @returns {Promise<object>} Un objeto con los datos de producción de cada máquina.
 */
async function parseProductionData(xmlText) {
    console.log("📦 Parseando XML...");
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const updatedTime = xmlDoc.querySelector('UpdatedTime').textContent;

  const result = { updatedTime };
  xmlDoc.querySelectorAll('ProductionLine').forEach(line => {
    const id = line.getAttribute('id').split('_')[1]; // Extrae 'A', 'B', etc.
    result[id] = {
      percent: parseFloat(line.querySelector('LoadOfLines').textContent),
      total: line.querySelector('TotalToProduce').textContent,
      produced: line.querySelector('TotalProduced').textContent,
      product: line.querySelector('Sequence').textContent
    };
  });
  return result;
}

/**
 * Carga y procesa los datos de secuencia para una máquina específica.
 * @param {string} machineId El ID de la máquina (ej. 'A').
 */
async function processSequenceData(machineId) {
  try {
    const response = await fetch(DATA_URLS.sequence[machineId]);
    const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
    
    // Mapea los elementos XML a un array de objetos JavaScript.
    const events = Array.from(xml.querySelectorAll("Event")).map(event => ({
      status: event.querySelector("State").textContent,
      from: event.querySelector("Start").textContent,
      to: event.querySelector("End").textContent,
      duration: event.querySelector("Duration").textContent,
      durSec: parseDurationToSeconds(event.querySelector("Duration").textContent)
    }));

    // Almacena los eventos y actualiza la visualización.
    machineEvents[machineId] = events;
    updateMachineStatus(machineId, events[events.length - 1]);
    drawSequenceChart(machineId);

  } catch (error) {
    console.error(`Error en secuencia ${machineId}:`, error);
    // Muestra un mensaje de error en el DOM si la carga falla.
    document.getElementById(`currentStatus_${machineId}`).innerHTML = `
      <span class="material-icons status-icon red">error_outline</span>
      <span>Error loading data</span>
    `;
  }
}

/* ===========================================================================
   FUNCIONES DE VISUALIZACIÓN
   =========================================================================== */

/**
 * Actualiza el estado visual de una máquina (OPERATING, IDLE, STOPPED).
 * @param {string} machineId El ID de la máquina.
 * @param {object} lastEvent El último evento registrado para la máquina.
 */
function updateMachineStatus(machineId, lastEvent) {
  const statusContainer = document.getElementById(`currentStatus_${machineId}`);
  let statusClass = '';
  let statusText = '';
  let duration = lastEvent.durSec;

  // Si el evento está "In progress", calcula la duración actual.
  if (lastEvent.to === "In progress") {
    const startDate = new Date(lastEvent.from);
    const now = new Date();
    duration = Math.floor((now - startDate) / 1000);
  }

  // Asigna clases y texto según el estado.
  switch (lastEvent.status) {
    case 'OPERATING':
      statusClass = 'operating';
      statusText = `OPERATING -- ${formatSecondsToHMS(duration)}`;
      break;
    case 'IDLE':
      statusClass = 'idle';
      statusText = `Inactiva por ${formatSecondsToHMS(duration)}`;
      break;
    case 'STOPPED':
      statusClass = 'stopped';
      statusText = `STOPPED --  ${formatSecondsToHMS(duration)}`;
      break;
    default:
      statusClass = 'stopped';
      statusText = 'Estado desconocido';
      break;
  }
  // Inserta el HTML actualizado.
  statusContainer.innerHTML = `
    <div class="status-container ${statusClass}">
      <span class="material-icons ${statusClass === 'operating' ? 'rotating-icon' : 'status-icon'}">
        ${statusClass === 'operating' ? 'settings' :
          statusClass === 'idle' ? 'pause_circle_outline' : 'settings'}
      </span>
      <span class="status-text">${statusText}</span>
    </div>
  `;
}

/**
 * Dibuja un gráfico de barras apiladas para mostrar la secuencia de eventos de una máquina.
 * @param {string} machineId El ID de la máquina.
 */
function drawSequenceChart(machineId) {
  if (!google.visualization) return;

  const events = machineEvents[machineId];
  const chartId = `sequence_chart_${machineId}`;
  var data = new google.visualization.DataTable();
  data.addColumn('string', 'Label');

  const eventColumns = [];
  const colors = [];
  const interactivity = [];
  let lastEndSec = 0;

  events.forEach(ev => {
    let durSec = ev.durSec;
    let tooltipEnd = ev.to;

    // Calcula la duración para eventos en progreso.
    if (ev.to === "In progress") {
      const startDate = new Date(ev.from);
      const now = new Date();
      durSec = Math.floor((now - startDate) / 1000);
      tooltipEnd = now.toISOString();
    }

    const startDate = new Date(ev.from);
    const startSec = startDate.getHours() * 3600 + startDate.getMinutes() * 60 + startDate.getSeconds();
    const gap = startSec - lastEndSec;

    // Rellena los huecos entre eventos.
    if (gap < 0 && lastEndSec !== 0) {
      lastEndSec = startSec;
    } else if (gap > 0) {
      eventColumns.push({ value: gap, tooltip: '' });
      colors.push('#666');
      interactivity.push(false);
    }

    eventColumns.push({
      value: durSec,
      tooltip: formatSecondsToHMS(durSec),
    });
//'#6FADCF'
    // Asigna colores según el estado.
    let color;
    if (ev.status === "OPERATING") color = '#8FCF6F';
    else if (ev.status === "IDLE") color = '#FF9800';
    else color = '#F44336';

    colors.push(color);
    interactivity.push(true);
    lastEndSec = startSec + durSec;
  });

  // Rellena el resto del día hasta 24h.
  const secondsInDay = 86400;
  if (lastEndSec < secondsInDay) {
    eventColumns.push({ value: secondsInDay - lastEndSec, tooltip: '' });
    colors.push('#666');
    interactivity.push(false);
  }

  // Crea las columnas para el DataTable.
  eventColumns.forEach((ev, idx) => {
    data.addColumn('number', `Segment ${idx}`);
    data.addColumn({ type: 'string', role: 'tooltip' });
  });

  // Crea la fila de datos.
  const row = [''];
  eventColumns.forEach(ev => {
    row.push(ev.value);
    row.push(ev.tooltip);
  });

  data.addRow(row);

  // Configuración de las opciones del gráfico.
  const options = {
    backgroundColor: '#2b2b2b',
    isStacked: true,
    height: 60,
    legend: 'none',
    bar: { groupWidth: '60%' },
    chartArea: { left: 40, top: 0, right: 40, bottom: 20, width: '100%', height: '100%' },
    hAxis: {
      minValue: 0,
      maxValue: 86400,
      textStyle: { color: '#ddd' },
      titleTextStyle: { color: '#ddd' },
      ticks: [
        { v: 0, f: "00:00" }, { v: 21600, f: "06:00" },
        { v: 50400, f: "14:00" }, { v: 79200, f: "22:00" },
        { v: 86400, f: "24:00" }
      ]
    },
    series: {}
  };

  // Aplica los colores y la interactividad a cada segmento.
  colors.forEach((color, idx) => {
    options.series[idx] = { color: color, enableInteractivity: interactivity[idx] };
  });

  const sequenceChart = new google.visualization.BarChart(document.getElementById(chartId));
  sequenceChart.draw(data, options);
}

/**
 * Crea una instancia de un medidor (gauge) y devuelve funciones para actualizarlo.
 * @param {string} machineId El ID de la máquina asociada.
 * @returns {object} Un objeto con las funciones `updateGauge` y `simulateData`.
 */
function createGauge(machineId) {
  // Configuración inicial del medidor.
  const gauge = new Gauge(document.getElementById(`gaugeCanvas_${machineId}`)).setOptions({
  angle: 0.10,
  lineWidth: 0.25,
  pointer: {
    length: 0.5,
    color: '#ffffff5b'
  },
  colorStart: '#e03843ff',   // azul claro
  colorStop: '#8FCF6F',    // verde claro
  strokeColor: '#E0E0E0',  // color del fondo del gauge
  generateGradient: true,  // activa el gradiente
  percentColors: [[0.0, "#e03843ff"], [1.0, "#8FCF6F"]] // opcional si quieres que el color cambie con el valor
});

  gauge.maxValue = 100;
  gauge.setMinValue(0);

  /**
   * Actualiza el medidor con nuevos datos de producción.
   * @param {number} percent El porcentaje de avance.
   * @param {string} produced Cantidad producida.
   * @param {string} total Cantidad total a producir.
   * @param {string} product Nombre del producto.
   */
  function updateGauge(percent, produced, total, product) {
    const producedNum = parseInt(produced) || 0;
    const totalNum = parseInt(total) || 1; // Evita división por cero
    const productText = product || 'N/A';
    const remaining = totalNum - producedNum;
    const porcent = Math.min(100, (producedNum / totalNum) * 100);

    gauge.set(porcent);
 
    // Actualiza los elementos del DOM asociados.
    document.getElementById(`nombreProducto_${machineId}`).textContent = productText;
    document.getElementById(`tiempoEstimado_${machineId}`).textContent = decimalToTime(percent);
    document.getElementById(`diferencia_${machineId}`).innerHTML = remaining <= 0 ?
      '<span style="color:#4CAF50">Completed</span>' :
      `<span style="color:${porcent < 30 ? '#F44336' : '#FFC107'}">-${remaining}</span>`;
    document.getElementById(`startLabel_${machineId}`).innerHTML = `<span class="material-icons">playlist_add_check</span> ${producedNum}`;
    document.getElementById(`endLabel_${machineId}`).innerHTML = `<span class="material-icons">flag</span> ${totalNum}`;
  }

  /**
   * Genera y aplica datos de producción simulados al medidor.
   */
  function simulateData() {
    const simulatedPercent = Math.floor(Math.random() * 100);
    updateGauge(simulatedPercent, simulatedPercent * 10, 1000, `SIM_${machineId}`);
  }

  return { updateGauge, simulateData };
}

/* ===========================================================================
   FUNCIONES DE LÓGICA PRINCIPAL (CARGA Y ACTUALIZACIÓN)
   =========================================================================== */

/**
 * Función principal para cargar todos los datos (producción y secuencia) y actualizar el dashboard.
 */
async function loadAllData() {
  console.log("🔴 INICIANDO loadAllData"); // Mensaje muy visible
  try {
    // 1. Cargar y procesar los datos de producción para todas las máquinas.
    const productionResponse = await fetch(DATA_URLS.production);
    const productionData = await parseProductionData(await productionResponse.text());

    // 2. Mostrar la hora de la última actualización.
    // Llamada garantizada a displayUpdatedTime
    if (productionData.updatedTime) {
      displayUpdatedTime(productionData.updatedTime);
      console.log('Valor de updatedTime:', productionData.updatedTime);
    } else {
      console.warn('No se encontró updatedTime en los datos');
      document.getElementById('update-time-value').textContent = 'Sin datos de tiempo';
    }

    // 3. Actualizar todos los medidores (gauges) con los datos nuevos.
    Object.keys(productionData).forEach(machineId => {
      if (machineId !== 'updatedTime' && gauges[machineId]) {
        console.log("🟡 Intentando cargar datos de producción...");
        const { percent, produced, total, product } = productionData[machineId];
        gauges[machineId].updateGauge(percent, produced, total, product);
      }
    });

    // 4. Cargar y procesar los datos de secuencia solo para A, B y C.
    await Promise.all(['A', 'B', 'C'].map(processSequenceData));

  } catch (error) {
    console.error("Error en carga general:", error);
    // En caso de error, usa datos simulados para los medidores como fallback.
    Object.keys(gauges).forEach(id => gauges[id].simulateData());
  }
}

/**
 * Actualiza solo los medidores (gauges) cargando de nuevo el archivo de producción.
 */
async function updateAllGauges() {
  try {
    const response = await fetch(DATA_URLS.production);
    const xmlText = await response.text();
    const xmlDoc = new DOMParser().parseFromString(xmlText, "text/xml");

    // Itera sobre las máquinas y actualiza sus medidores.
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I','j'].forEach(id => {
      const lineData = xmlDoc.querySelector(`ProductionLine[id="L10_${id}"]`);
      if (lineData && gauges[id]) {
        const percent = parseFloat(lineData.querySelector('LoadOfLines').textContent);
        const total = lineData.querySelector('TotalToProduce').textContent;
        const produced = lineData.querySelector('TotalProduced').textContent;
        const product = lineData.querySelector('Sequence').textContent;
        gauges[id].updateGauge(percent, produced, total, product);
      }
    });
  } catch (error) {
    console.error("Error updating gauges:", error);
    // Usa datos simulados si la actualización falla.
    Object.keys(gauges).forEach(id => gauges[id].simulateData());
  }
}


/* ===========================================================================
   INICIALIZACIÓN DE LA APLICACIÓN
   =========================================================================== */

// Inicializa las gráficas de secuencia (A, B, C) una vez que Google Charts esté cargado.
google.charts.setOnLoadCallback(() => {
 
 
    // Carga inicial de datos de secuencia.
  ['A', 'B', 'C'].forEach(id => {
    processSequenceData(id);
  });
  
  // Configura un intervalo para actualizar periódicamente los datos de secuencia.
  setInterval(() => {
    ['A', 'B', 'C'].forEach(id => processSequenceData(id));
  }, UPDATE_INTERVALS.SEQUENCE);
});

// Inicializa los medidores (gauges) una vez que el DOM esté completamente cargado.
document.addEventListener('DOMContentLoaded', () => {
  // Crea e inicializa todas las instancias de los medidores.
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I','J'].forEach(id => {
    gauges[id] = createGauge(id);
  });

  // Realiza una carga inicial de datos para los medidores.
  loadAllData();
  updateAllGauges();
  
  // Configura un intervalo para actualizar periódicamente los datos de los medidores.
  setInterval(updateAllGauges, UPDATE_INTERVALS.GAUGES);
  setInterval(loadAllData, UPDATE_INTERVALS.GAUGES);
});