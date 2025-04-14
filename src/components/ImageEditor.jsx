import React, { useEffect, useRef, useState, useCallback } from "react";
import { fabric } from "fabric";

// --- Constantes y Configuraciones ---
const CANVAS_WIDTH = 800; // Ancho predeterminado del canvas
const CANVAS_HEIGHT = 600; // Alto predeterminado del canvas
const MAX_COLOR_HISTORY = 10; // Número máximo de colores a guardar en el historial
const DUPLICATE_OFFSET = 20; // Desplazamiento en píxeles para los objetos duplicados

// --- Funciones Auxiliares (Helpers) ---

/**
 * Convierte un color hexadecimal (#RRGGBB) a una cadena de componentes RGB "r,g,b".
 * @param {string} hex - El color hexadecimal (con o sin #).
 * @returns {string} Cadena RGB "r,g,b".
 */
const hexToRgb = (hex) => {
    const hexClean = hex.startsWith('#') ? hex.slice(1) : hex;
    if (hexClean.length !== 6 && hexClean.length !== 3) return '0,0,0'; // Fallback para hex inválido
    const bigint = parseInt(hexClean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r},${g},${b}`;
};

/**
 * Convierte una cadena de color (hex, rgb, rgba, nombre) a un objeto con { hex, alpha }.
 * Utiliza fabric.Color para un parseo robusto.
 * @param {string} colorString - La cadena de color a parsear.
 * @returns {{hex: string, alpha: number}} Objeto con el color base hexadecimal y la opacidad (0-1).
 */
const colorStringToParts = (colorString) => {
    try {
        const color = new fabric.Color(colorString);
        const hex = color.toHex();
        const source = color.getSource(); // [r, g, b, a]
        const alpha = source[3] !== undefined ? source[3] : 1;
        return { hex: `#${hex}`, alpha: alpha };
    } catch (e) {
        console.warn("Could not parse color string:", colorString);
        console.error(e);
        return { hex: '#000000', alpha: 1 }; // Fallback
    }
};

/**
 * Pone en mayúscula el primer carácter de una cadena.
 * @param {string} str - La cadena a capitalizar.
 * @returns {string} La cadena capitalizada o una cadena vacía si la entrada es inválida.
 */
const capitalize = (str) => (str && typeof str === 'string' ? str.charAt(0).toUpperCase() + str.slice(1) : '');

/**
 * Genera un ID único basado en la fecha y un número aleatorio.
 * Se usa para identificar objetos de Fabric de forma única en el estado de React.
 * @returns {string} Un ID único.
 */
const generateUid = () => `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// --- Componente Principal ---

export default function ImageEditor() {
    // --- Refs ---
    const canvasRef = useRef(null); // Ref al elemento <canvas> del DOM
    const fabricCanvasRef = useRef(null); // Ref a la instancia de fabric.Canvas
    const objectCountRef = useRef(0); // Ref para llevar la cuenta de objetos creados (para nombres únicos)

    // --- Estado del Componente ---

    // Lista de objetos/capas para el panel lateral. Cada item tiene { id, name, type, ref }
    const [objects, setObjects] = useState([]);
    // Conjunto (Set) de IDs de las capas seleccionadas en el panel de capas. Facilita la multi-selección.
    const [selectedLayerIds, setSelectedLayerIds] = useState(new Set());

    // Estado para gestionar la visibilidad y posición del menú contextual del panel de capas
    const [layerContextMenu, setLayerContextMenu] = useState({
        visible: false, x: 0, y: 0, layerId: null,
    });

    // Estados para las herramientas de estilo aplicadas al objeto/selección activa
    const [selectedColor, setSelectedColor] = useState("#000000"); // Color HEX
    const [selectedOpacity, setSelectedOpacity] = useState(1);     // Opacidad (0 a 1)
    const [fontFamily, setFontFamily] = useState("Arial");          // Fuente para texto
    const [fontWeight, setFontWeight] = useState("normal");         // Grosor para texto
    const [currentRadius, setCurrentRadius] = useState(0);          // Radio de borde para rectángulos

    // Estados para controlar el color y opacidad del fondo del canvas
    const [backgroundColor, setBackgroundColor] = useState("#ffffff"); // Color HEX
    const [backgroundOpacity, setBackgroundOpacity] = useState(1);     // Opacidad (0 a 1)

    // Historial de colores usados recientemente (almacena colores en formato RGBA)
    const [colorHistory, setColorHistory] = useState([]);

    // --- Efectos ---

    /**
     * Efecto de inicialización del componente.
     * Se ejecuta una sola vez al montar. Crea la instancia de Fabric.js,
     * configura el canvas y añade los listeners de eventos necesarios.
     */
    useEffect(() => {
        const canvasElement = canvasRef.current;
        if (!canvasElement) return; // Salir si el elemento <canvas> no está montado

        // Calcula el color de fondo inicial en formato RGBA
        const initialBgColor = `rgba(${hexToRgb(backgroundColor)}, ${backgroundOpacity})`;

        // Crea la instancia principal de Fabric Canvas
        const canvas = new fabric.Canvas(canvasElement, {
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            backgroundColor: initialBgColor,
            preserveObjectStacking: true, // Mantiene el orden Z de los objetos
            stopContextMenu: true,       // Evita que Fabric muestre su propio menú contextual (si lo tuviera)
            fireRightClick: true,        // Habilita eventos 'mouse:down' para el botón derecho
        });
        fabricCanvasRef.current = canvas; // Almacena la instancia en la ref

        // --- Suscripción a Eventos de Fabric ---
        // Eventos que indican cambios en los objetos (añadir, quitar, mover, escalar, etc.)
        canvas.on("object:added", handleCanvasObjectChange);
        canvas.on("object:removed", handleCanvasObjectChange);
        canvas.on("object:modified", handleCanvasObjectChange); // Incluye transformaciones
        // Eventos relacionados con la selección de objetos en el canvas
        canvas.on("selection:created", handleCanvasSelectionChange);
        canvas.on("selection:updated", handleCanvasSelectionChange);
        canvas.on("selection:cleared", handleCanvasSelectionCleared);

        // Listener para el menú contextual personalizado sobre el canvas
        canvas.wrapperEl.addEventListener("contextmenu", handleCanvasContextMenu); // Usar wrapperEl para capturar en toda el área

        // Listener global para cerrar menús contextuales al hacer clic fuera de ellos
        document.addEventListener('click', handleClickOutsideMenus);

        // --- Función de Limpieza (Cleanup) ---
        // Se ejecuta cuando el componente se desmonta para liberar recursos
        return () => {
            // Elimina los listeners de eventos de Fabric
            canvas.off("object:added", handleCanvasObjectChange);
            canvas.off("object:removed", handleCanvasObjectChange);
            canvas.off("object:modified", handleCanvasObjectChange);
            canvas.off("selection:created", handleCanvasSelectionChange);
            canvas.off("selection:updated", handleCanvasSelectionChange);
            canvas.off("selection:cleared", handleCanvasSelectionCleared);
            // Elimina el listener del DOM (importante usar la misma referencia de función)
            // eslint-disable-next-line react-hooks/exhaustive-deps
            canvas.wrapperEl?.removeEventListener("contextmenu", handleCanvasContextMenu);
            document.removeEventListener('click', handleClickOutsideMenus);
            // Libera la memoria y recursos asociados al canvas de Fabric
            canvas.dispose();
            fabricCanvasRef.current = null; // Limpia la ref
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Array de dependencias vacío asegura que el efecto se ejecute solo una vez

    // --- Callbacks para Eventos de Fabric (Optimizados con useCallback) ---

    /** Callback invocado cuando se añade, elimina o modifica un objeto en el canvas. */
    const handleCanvasObjectChange = useCallback(() => {
        updateObjectList(); // Actualiza la lista de capas en el panel
    }, []);

    /** Callback invocado cuando se crea o actualiza una selección en el canvas. */
    const handleCanvasSelectionChange = useCallback((options) => {
        // Obtiene los objetos Fabric seleccionados actualmente
        const selectedFabricObjects = options.selected || (options.target ? [options.target] : []);
        // Actualiza los controles de estilo (color, fuente, etc.) según la selección
        updateControlsFromSelection(selectedFabricObjects);
        // Sincroniza la selección del panel de capas con la del canvas
        const selectedIds = new Set(selectedFabricObjects.map(obj => obj.__uid).filter(Boolean));
        setSelectedLayerIds(selectedIds);
        closeLayerContextMenu(); // Cierra menú de capas si está abierto
    }, []);

    /** Callback invocado cuando se limpia la selección en el canvas (clic fuera). */
    const handleCanvasSelectionCleared = useCallback(() => {
        setSelectedLayerIds(new Set()); // Limpia la selección en el panel de capas
        closeLayerContextMenu(); // Cierra menú de capas
        // Opcional: Resetear controles de estilo a valores por defecto aquí
    }, []);

    // --- Gestión de Objetos y Capas ---

    /**
     * Actualiza el estado `objects` (la lista de capas).
     * Obtiene los objetos del canvas, asegura que tengan ID y nombre,
     * y los invierte para que la capa superior en el canvas aparezca arriba en la lista UI.
     */
    const updateObjectList = () => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return; // Salir si el canvas no está inicializado

        const currentFabricObjects = canvas.getObjects(); // Obtiene todos los objetos del canvas
        const objs = currentFabricObjects.map((obj) => {
            // Asegura que cada objeto tenga un ID único
            if (!obj.__uid) {
                obj.__uid = generateUid();
            }
            // Asigna un nombre por defecto si no existe
            if (!obj.name) {
                obj.name = `${capitalize(obj.type || 'objeto')} ${obj.__uid.slice(-4)}`;
            }
            // Devuelve la estructura de datos para el panel de capas
            return {
                id: obj.__uid,
                name: obj.name,
                type: obj.type || 'unknown', // Tipo del objeto (rect, circle, text, group, image, etc.)
                ref: obj, // Referencia directa al objeto Fabric (usar con cuidado)
            };
        }).reverse(); // Invierte para mostrar el orden visual correcto (arriba = top)

        setObjects(objs); // Actualiza el estado de React, lo que re-renderiza el panel
    };

    /**
     * Asigna un ID único (`__uid`) y un nombre descriptivo a un objeto Fabric.
     * Utiliza y incrementa el contador global `objectCountRef`.
     * @param {fabric.Object} obj - El objeto Fabric a modificar.
     * @param {string} type - El tipo base del objeto (e.g., 'rect', 'text', 'group', 'image').
     * @returns {fabric.Object} El mismo objeto modificado.
     */
    const assignUidAndName = (obj, type) => {
        objectCountRef.current++;
        obj.__uid = generateUid();
        obj.name = `${capitalize(type)} ${objectCountRef.current}`;
        return obj;
    };

    /**
     * Renombra un objeto en el canvas y actualiza la lista de capas.
     * @param {string} id - El ID (`__uid`) del objeto a renombrar.
     * @param {string} newName - El nuevo nombre para el objeto.
     */
    const renameObject = (id, newName) => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        const obj = canvas.getObjects().find((o) => o.__uid === id); // Busca el objeto por ID
        if (obj) {
            obj.set('name', newName); // Establece la nueva propiedad 'name' en el objeto Fabric
            updateObjectList(); // Actualiza el panel de capas para reflejar el cambio
            canvas.renderAll(); // Re-renderiza el canvas (por si acaso)
        }
    };

    /**
     * Maneja el evento 'drop' en el panel de capas para reordenar los objetos.
     * @param {React.DragEvent} e - El evento de drop.
     * @param {number} toIndex - El índice (en la lista `objects` invertida) donde se soltó el elemento.
     */
    const handleLayerDrop = (e, toIndex) => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        e.preventDefault(); // Prevenir comportamiento por defecto del navegador
        closeLayerContextMenu(); // Cerrar menú si estaba abierto

        const fromId = e.dataTransfer.getData("text/plain"); // Obtiene el ID del objeto arrastrado
        const fromObjectInfo = objects.find(o => o.id.toString() === fromId); // Busca info en el estado `objects`

        // Salir si no se encuentra el objeto o si se suelta sobre sí mismo
        if (!fromObjectInfo || fromObjectInfo.id === objects[toIndex]?.id) return;

        // --- Lógica de Reordenamiento en Fabric.js ---
        // Fabric organiza los objetos con índice 0 en el fondo y N-1 arriba.
        // Nuestro array `objects` está invertido (índice 0 es el de arriba).

        const fabricObjectToMove = canvas.getObjects().find(o => o.__uid === fromObjectInfo.id); // Encuentra el objeto Fabric real
        if (!fabricObjectToMove) return; // Seguridad

        const totalFabricObjects = canvas.getObjects().length;
        // Calcula el índice de destino en la pila de Fabric (0 = fondo)
        // Si toIndex es 0 (arriba de la lista UI), targetFabricIndex debe ser total-1 (arriba del canvas)
        const targetFabricIndex = totalFabricObjects - 1 - toIndex;

        canvas.moveTo(fabricObjectToMove, targetFabricIndex); // Mueve el objeto en la pila de Fabric
        canvas.requestRenderAll(); // Solicita un re-renderizado del canvas
        updateObjectList(); // Actualiza el panel de capas para reflejar el nuevo orden
    };

    // --- Selección y Acciones en el Panel de Capas ---

    /**
     * Maneja los clics en los elementos de la lista de capas.
     * Implementa selección simple y múltiple (con Ctrl/Cmd).
     * Sincroniza la selección del panel con la selección del canvas.
     * @param {React.MouseEvent} e - Evento de clic.
     * @param {string} clickedId - ID de la capa clickeada.
     */
    const handleLayerClick = (e, clickedId) => {
        closeLayerContextMenu(); // Cierra menú contextual si estaba abierto
        const isCtrlOrCmd = e.ctrlKey || e.metaKey; // Detecta si se presionó Ctrl (Win/Linux) o Cmd (Mac)
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        // Actualiza el estado `selectedLayerIds`
        setSelectedLayerIds(prevSelectedIds => {
            const newSelectedIds = new Set(prevSelectedIds);
            if (isCtrlOrCmd) {
                // Selección múltiple: Añade o quita el ID clickeado del Set
                if (newSelectedIds.has(clickedId)) newSelectedIds.delete(clickedId);
                else newSelectedIds.add(clickedId);
            } else {
                // Selección simple: Limpia el Set y añade solo el ID clickeado
                newSelectedIds.clear();
                newSelectedIds.add(clickedId);
            }

            // --- Sincronizar Selección con el Canvas de Fabric ---
            // Obtiene los objetos Fabric correspondientes a los IDs seleccionados
            const selectedFabricObjects = canvas.getObjects().filter(obj => newSelectedIds.has(obj.__uid));

            canvas.discardActiveObject(); // Deselecciona todo en el canvas primero
            if (selectedFabricObjects.length === 1) {
                canvas.setActiveObject(selectedFabricObjects[0]); // Selecciona un único objeto
            } else if (selectedFabricObjects.length > 1) {
                // Crea una selección activa temporal (ActiveSelection) para múltiples objetos
                const sel = new fabric.ActiveSelection(selectedFabricObjects, { canvas: canvas });
                canvas.setActiveObject(sel);
            }
            // Si selectedFabricObjects.length es 0, la deselección ya está hecha.

            canvas.requestRenderAll(); // Solicita re-renderizado del canvas
            return newSelectedIds; // Devuelve el nuevo Set para actualizar el estado de React
        });
    };

    /**
     * Maneja el clic derecho en un elemento de la lista de capas.
     * Muestra el menú contextual (`layerContextMenu`) en la posición del clic.
     * Ajusta la selección si es necesario antes de mostrar el menú.
     * @param {React.MouseEvent} e - Evento de clic derecho.
     * @param {string} layerId - ID de la capa sobre la que se hizo clic derecho.
     */
    const handleLayerContextMenu = (e, layerId) => {
        e.preventDefault(); // Previene el menú contextual nativo del navegador
        closeLayerContextMenu(); // Cierra cualquier menú de capa previo
        closeCanvasContextMenu(); // Cierra menú de canvas previo

        const isCtrlOrCmd = e.ctrlKey || e.metaKey;
        const clickedLayerIsSelected = selectedLayerIds.has(layerId);
        let finalSelectedIds = new Set(selectedLayerIds);

        // Lógica para ajustar la selección antes de mostrar el menú:
        if (!clickedLayerIsSelected && !isCtrlOrCmd) {
            // Clic derecho simple sobre capa no seleccionada: selecciona solo esa capa
            finalSelectedIds = new Set([layerId]);
        } else if (!clickedLayerIsSelected && isCtrlOrCmd) {
            // Clic derecho con Ctrl/Cmd sobre capa no seleccionada: la añade a la selección
            finalSelectedIds.add(layerId);
        }
        // Si se hace clic derecho sobre una capa ya seleccionada, no se cambia la selección.

        // Si la selección cambió, actualiza el estado y el canvas
        if (finalSelectedIds.size !== selectedLayerIds.size || !Array.from(finalSelectedIds).every(id => selectedLayerIds.has(id))) {
            setSelectedLayerIds(finalSelectedIds);
            // Sincroniza con Fabric
            const canvas = fabricCanvasRef.current;
            if (canvas) {
                const objsToSelect = canvas.getObjects().filter(obj => finalSelectedIds.has(obj.__uid));
                canvas.discardActiveObject();
                if (objsToSelect.length === 1) {
                    canvas.setActiveObject(objsToSelect[0]);
                } else if (objsToSelect.length > 1) {
                    const sel = new fabric.ActiveSelection(objsToSelect, { canvas: canvas });
                    canvas.setActiveObject(sel);
                }
                canvas.requestRenderAll();
            }
        }

        // Muestra el menú contextual en la posición del cursor
        setLayerContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            // layerId: layerId // Guardamos el ID original si es útil, aunque las acciones usan finalSelectedIds
        });
    };

    /** Cierra el menú contextual de capas reseteando su estado. */
    const closeLayerContextMenu = () => {
        if (layerContextMenu.visible) {
            setLayerContextMenu({ visible: false, x: 0, y: 0, layerId: null });
        }
    };

    /** Cierra el menú contextual del canvas eliminándolo del DOM si existe. */
    const closeCanvasContextMenu = () => {
        const menu = document.getElementById("canvas-context-menu");
        if (menu && document.body.contains(menu)) {
            document.body.removeChild(menu);
        }
    };

    /**
     * Manejador de clics global para cerrar los menús contextuales si se hace clic fuera de ellos.
     * @param {MouseEvent} event - Evento de clic.
     */
    const handleClickOutsideMenus = useCallback((event) => {
        const layerMenu = document.getElementById("layer-context-menu");
        if (layerMenu && !layerMenu.contains(event.target)) {
            closeLayerContextMenu();
        }
        const canvasMenu = document.getElementById("canvas-context-menu");
        if (canvasMenu && !canvasMenu.contains(event.target)) {
            closeCanvasContextMenu();
        }
    }, []); // Dependencia vacía, las funciones de cierre no cambian

    // --- Actualización de Controles desde Selección del Canvas ---

    /**
     * Actualiza los controles de estilo (color, fuente, opacidad, radio)
     * basándose en las propiedades del primer objeto de la selección activa del canvas.
     * @param {fabric.Object[]} selectedFabricObjects - Array de objetos Fabric seleccionados.
     */
    const updateControlsFromSelection = (selectedFabricObjects) => {
        if (!selectedFabricObjects || selectedFabricObjects.length === 0) return;
        // Usa el primer objeto para definir los estilos (limitación en selecciones múltiples)
        const activeObject = selectedFabricObjects[0];

        if (activeObject) {
            // Actualizar Color y Opacidad de Relleno
            let fillColor = '#000000', fillOpacity = 1; // Valores por defecto
            if (activeObject.fill && typeof activeObject.fill === 'string') {
                const { hex, alpha } = colorStringToParts(activeObject.fill);
                fillColor = hex;
                fillOpacity = alpha;
            } else if (activeObject.type === 'group' && activeObject._objects?.length > 0) {
                // Intenta obtener del primer objeto dentro del grupo
                const firstInGroup = activeObject._objects[0];
                if (firstInGroup.fill && typeof firstInGroup.fill === 'string') {
                    const { hex, alpha } = colorStringToParts(firstInGroup.fill);
                    fillColor = hex;
                    fillOpacity = alpha;
                }
            }
            setSelectedColor(fillColor);
            setSelectedOpacity(fillOpacity);

            // Actualizar Fuente y Grosor (si es texto)
            if (activeObject.type?.includes('text')) {
                setFontFamily(activeObject.fontFamily || "Arial");
                setFontWeight(activeObject.fontWeight || "normal");
            }

            // Actualizar Radio de Bordes (si es rectángulo)
            if (activeObject.type === 'rect') {
                setCurrentRadius(activeObject.rx || 0); // Usa rx, asume ry es igual
            } else {
                setCurrentRadius(0); // Resetea si no es rectángulo
            }
        }
    };


    // --- Aplicar Estilos a Objetos Activos del Canvas ---

    /**
     * Aplica una propiedad y valor a todos los objetos actualmente seleccionados en el canvas.
     * Maneja selecciones simples y múltiples (ActiveSelection).
     * Aplica propiedades solo si son relevantes para el tipo de objeto.
     * @param {string} property - Nombre de la propiedad Fabric a modificar (e.g., 'fill', 'fontFamily', 'rx').
     * @param {*} value - El nuevo valor para la propiedad.
     */
    const applyToActiveObject = (property, value) => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        const activeObject = canvas.getActiveObject(); // Objeto o ActiveSelection
        if (!activeObject) return;

        // Obtiene la lista de objetos individuales a modificar
        const targets = activeObject.type === 'activeSelection'
            ? activeObject.getObjects()
            : [activeObject];

        targets.forEach(obj => {
            // Verifica si la propiedad es aplicable al tipo de objeto
            const isText = obj.type?.includes('text');
            const isRect = obj.type === 'rect';
            let applyChange = false;

            if (property === 'fill') applyChange = true;
            else if ((property === 'fontFamily' || property === 'fontWeight') && isText) applyChange = true;
            else if ((property === 'rx' || property === 'ry') && isRect) applyChange = true;
            // Añadir más condiciones para otras propiedades aquí

            if (applyChange) {
                obj.set(property, value); // Modifica la propiedad del objeto Fabric
                // Caso especial: si se cambia 'rx', también cambia 'ry'
                if (property === 'rx' && isRect) {
                    obj.set('ry', value);
                }
            }
        });

        canvas.requestRenderAll(); // Solicita re-renderizado

        // Si se cambió el relleno, actualiza los controles (por si la opacidad cambió)
        if (property === 'fill') {
            updateControlsFromSelection(targets);
        }
    };


    // --- Manejadores de UI para Controles de Estilo ---

    /** Maneja el cambio en el input de color (selector). Aplica inmediatamente. */
    const handleColorChange = (e) => {
        const newHexColor = e.target.value;
        setSelectedColor(newHexColor);
        const currentRgbaColor = `rgba(${hexToRgb(newHexColor)}, ${selectedOpacity})`;
        applyToActiveObject("fill", currentRgbaColor);
    };

    /** Maneja el cambio en el input range de opacidad. Aplica inmediatamente. */
    const handleOpacityChange = (e) => {
        const newOpacity = parseFloat(e.target.value);
        setSelectedOpacity(newOpacity);
        const newRgbaColor = `rgba(${hexToRgb(selectedColor)}, ${newOpacity})`;
        applyToActiveObject("fill", newRgbaColor);
    };

    /** Maneja el evento 'blur' (pérdida de foco) del input de color. Guarda en el historial. */
    const handleColorBlur = () => {
        const finalRgbaColor = `rgba(${hexToRgb(selectedColor)}, ${selectedOpacity})`;
        // Podríamos re-aplicar por seguridad, pero handleColorChange/OpacityChange ya lo hicieron
        updateColorHistory(finalRgbaColor); // Guarda el color RGBA final en el historial
    };

    /** Maneja el cambio en el selector de fuente. */
    const handleFontChange = (e) => {
        const font = e.target.value;
        setFontFamily(font);
        applyToActiveObject("fontFamily", font);
    };

    /** Maneja el cambio en el selector de grosor de fuente. */
    const handleFontWeightChange = (e) => {
        const weight = e.target.value;
        setFontWeight(weight);
        applyToActiveObject("fontWeight", weight);
    };

    /** Maneja el cambio en el input range de radio de borde. */
    const handleRadiusChange = (e) => {
        const value = parseInt(e.target.value, 10);
        setCurrentRadius(value);
        applyToActiveObject("rx", value); // ry se aplica dentro de applyToActiveObject
    };

    /** Maneja el cambio en el selector de color de fondo del canvas. */
    const handleBackgroundColorChange = (e) => {
        const newBgColorHex = e.target.value;
        setBackgroundColor(newBgColorHex);
        const newRgbaBg = `rgba(${hexToRgb(newBgColorHex)}, ${backgroundOpacity})`;
        fabricCanvasRef.current?.setBackgroundColor(newRgbaBg, fabricCanvasRef.current.renderAll.bind(fabricCanvasRef.current));
    };

    /** Maneja el cambio en el input range de opacidad del fondo del canvas. */
    const handleBackgroundOpacityChange = (e) => {
        const newBgOpacity = parseFloat(e.target.value);
        setBackgroundOpacity(newBgOpacity);
        const newRgbaBg = `rgba(${hexToRgb(backgroundColor)}, ${newBgOpacity})`;
        fabricCanvasRef.current?.setBackgroundColor(newRgbaBg, fabricCanvasRef.current.renderAll.bind(fabricCanvasRef.current));
    };

    // --- Añadir Objetos al Canvas ---

    /**
     * Añade una forma geométrica (rectángulo o círculo) al canvas.
     * @param {'rect' | 'circle'} type - El tipo de forma a añadir.
     */
    const addShape = (type) => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        const fillColor = `rgba(${hexToRgb(selectedColor)}, ${selectedOpacity})`;
        let shape;

        switch (type) {
            case 'rect':
                shape = new fabric.Rect({ width: 100, height: 100, fill: fillColor, left: 50, top: 50, rx: 0, ry: 0 });
                break;
            case 'circle':
                shape = new fabric.Circle({ radius: 50, fill: fillColor, left: 200, top: 50 });
                break;
            default: return;
        }
        assignUidAndName(shape, type); // Asigna ID y nombre único
        canvas.add(shape);
        canvas.setActiveObject(shape); // Selecciona el nuevo objeto
        canvas.requestRenderAll();
        updateColorHistory(fillColor); // Añade el color al historial
    };

    /** Añade un objeto de texto editable (Textbox) al canvas. */
    const addText = () => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        const fillColor = `rgba(${hexToRgb(selectedColor)}, ${selectedOpacity})`;
        const text = new fabric.Textbox("Texto Ejemplo", {
            left: 100, top: 200, fontSize: 24,
            fill: fillColor, fontFamily: fontFamily, fontWeight: fontWeight,
            width: 150, splitByGrapheme: true, // Ancho inicial y mejor manejo de caracteres
        });
        assignUidAndName(text, 'text');
        canvas.add(text);
        canvas.setActiveObject(text);
        canvas.requestRenderAll();
        updateColorHistory(fillColor);
    };

    /**
     * Maneja la subida de un archivo de imagen, la lee y la añade al canvas.
     * @param {React.ChangeEvent<HTMLInputElement>} e - Evento de cambio del input file.
     */
    const handleImageUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file || !fabricCanvasRef.current) return;
        const reader = new FileReader();
        reader.onload = (f) => {
            const dataUrl = f.target?.result;
            if (dataUrl) {
                fabric.Image.fromURL(dataUrl, (img) => {
                    assignUidAndName(img, 'image');
                    img.scaleToWidth(300); // Escala inicial
                    img.set({ left: 100, top: 100 }); // Posición inicial
                    fabricCanvasRef.current.add(img);
                    fabricCanvasRef.current.setActiveObject(img);
                    fabricCanvasRef.current.requestRenderAll();
                }, { crossOrigin: 'anonymous' }); // Necesario si se cargan imágenes de otras fuentes y se quieren exportar
            }
        };
        reader.readAsDataURL(file);
        e.target.value = ''; // Resetea input para permitir re-subir el mismo archivo
    };

    // --- Historial de Color ---

    /**
     * Añade un color (RGBA) al historial, manteniendo un tamaño máximo.
     * @param {string} rgbaColor - Color a añadir (e.g., "rgba(255,0,0,0.5)").
     */
    const updateColorHistory = (rgbaColor) => {
        setColorHistory((prev) => {
            const filtered = prev.filter((c) => c !== rgbaColor); // Elimina duplicados previos
            return [rgbaColor, ...filtered].slice(0, MAX_COLOR_HISTORY); // Añade al inicio y limita tamaño
        });
    };

    /**
     * Aplica un color del historial al objeto activo y actualiza los controles de UI.
     * @param {string} rgbaColor - El color RGBA del historial seleccionado.
     */
    const applyColorFromHistory = (rgbaColor) => {
        const { hex, alpha } = colorStringToParts(rgbaColor); // Parsea a Hex y Alpha
        setSelectedColor(hex);         // Actualiza control de color
        setSelectedOpacity(alpha);      // Actualiza control de opacidad
        applyToActiveObject("fill", rgbaColor); // Aplica el RGBA original al objeto
    };

    // --- Lógica Central de Agrupar/Desagrupar ---

    /**
     * Desagrupa un objeto fabric.Group dado.
     * Añade los objetos hijos al canvas, elimina el grupo y selecciona los hijos.
     * @param {fabric.Group} groupObject - El grupo a desagrupar.
     * @param {fabric.Canvas} canvas - La instancia del canvas.
     * @returns {fabric.Object[]} Array de los objetos que fueron desagrupados.
     */
    const ungroupObject = (groupObject, canvas) => {
        if (!canvas || !groupObject || groupObject.type !== 'group') return [];
        // Método recomendado para desagrupar: destruye el grupo y devuelve los objetos hijos
        const items = groupObject.destroy()?.objects || groupObject._objects || []; // Asegura obtener los objetos hijos
        // Es posible que necesitemos añadirlos manualmente si destroy() no lo hace
        // items.forEach(item => canvas.add(item)); // Usualmente no es necesario con destroy() moderno

        canvas.remove(groupObject); // Asegura que el objeto grupo se elimine
        return items; // Devuelve los objetos hijos
    };

    // --- Menú Contextual del Canvas ---

    /**
     * Maneja el evento de clic derecho sobre el canvas. Muestra un menú contextual
     * con opciones relevantes para el objeto o selección activa bajo el cursor.
     * @param {MouseEvent} e - El evento de clic derecho.
     */
    const handleCanvasContextMenu = (e) => {
        e.preventDefault(); // Previene el menú nativo
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        closeCanvasContextMenu(); // Cierra menú previo
        closeLayerContextMenu(); // Cierra menú de capas

        // Encuentra el objeto bajo el cursor. Si no hay, usa la selección activa.
        const target = canvas.findTarget(e, true) || canvas.getActiveObject(); // true busca dentro de grupos/selecciones

        if (target) {
            const menu = document.createElement("div"); // Crea el contenedor del menú
            menu.id = "canvas-context-menu"; // ID para poder cerrarlo
            // Estilos básicos del menú
            Object.assign(menu.style, {
                position: "absolute", left: `${e.pageX}px`, top: `${e.pageY}px`,
                background: "white", border: "1px solid #ccc", borderRadius: "4px",
                boxShadow: "2px 2px 5px rgba(0,0,0,0.2)", zIndex: "10000",
                color: "black", fontSize: "14px", minWidth: "120px",
            });

            // Helper para crear elementos (items) del menú
            const createMenuItem = (text, onClick, disabled = false) => {
                const item = document.createElement("div");
                item.textContent = text;
                item.style.padding = "8px 15px";
                item.style.cursor = disabled ? "not-allowed" : "pointer";
                item.style.opacity = disabled ? "0.5" : "1";
                if (!disabled) {
                    item.onmouseover = () => item.style.backgroundColor = "#f0f0f0";
                    item.onmouseout = () => item.style.backgroundColor = "white";
                    item.onclick = (event) => {
                        event.stopPropagation();
                        onClick(); // Ejecuta la acción asociada
                        closeCanvasContextMenu(); // Cierra el menú
                    };
                }
                return item;
            };

            // --- Definición de las Acciones del Menú ---
            const isGroup = target.type === 'group';
            const isSelection = target.type === 'activeSelection';

            // Acción: ELIMINAR
            menu.appendChild(createMenuItem("Eliminar", () => {
                const objectsToRemove = isSelection ? target.getObjects() : [target];
                objectsToRemove.forEach(obj => canvas.remove(obj));
                if (isSelection) canvas.discardActiveObject(); // Limpia selección si era múltiple
                canvas.requestRenderAll();
                updateObjectList();
            }));

            // Acción: DUPLICAR
            menu.appendChild(createMenuItem("Duplicar", () => {
                const originals = isSelection ? target.getObjects() : [target];
                const clones = [];
                originals.forEach(original => {
                    original.clone((cloned) => {
                        cloned.set({ left: original.left + DUPLICATE_OFFSET, top: original.top + DUPLICATE_OFFSET });
                        assignUidAndName(cloned, original.type || 'objeto');
                        canvas.add(cloned);
                        clones.push(cloned);
                    }, ['__uid', 'name']); // Asegura copiar propiedades personalizadas si es necesario
                });

                // Seleccionar los clones después de que se completen (puede requerir async/await o Promise.all si clone es asíncrono)
                setTimeout(() => { // Usamos timeout como workaround simple
                    canvas.discardActiveObject();
                    if (clones.length === 1) canvas.setActiveObject(clones[0]);
                    else if (clones.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(clones, { canvas: canvas }));
                    canvas.requestRenderAll();
                    updateObjectList();
                }, 50); // Ajustar delay si es necesario
            }));

            // --- Separador ---
            const separator = document.createElement('div');
            Object.assign(separator.style, { height: '1px', backgroundColor: '#eee', margin: '4px 0' });
            menu.appendChild(separator);

            // Acción: AGRUPAR (solo si hay selección múltiple)
            if (isSelection) {
                menu.appendChild(createMenuItem("Agrupar", () => {
                    const newGroup = target.toGroup(); // Convierte ActiveSelection a Group
                    assignUidAndName(newGroup, 'group');
                    canvas.setActiveObject(newGroup); // Selecciona el nuevo grupo
                    canvas.requestRenderAll();
                    updateObjectList();
                }));
            }

            // Acción: DESAGRUPAR (solo si el target es un grupo)
            if (isGroup) {
                menu.appendChild(createMenuItem("Desagrupar", () => {
                    const items = ungroupObject(target, canvas); // Llama a la función central de desagrupar
                    if (items.length > 0) {
                        // Selecciona los objetos recién desagrupados
                        canvas.setActiveObject(new fabric.ActiveSelection(items, { canvas: canvas }));
                    } else {
                        canvas.discardActiveObject();
                    }
                    canvas.requestRenderAll();
                    updateObjectList();
                }));
            }

            // --- Añadir Menú al DOM y Listener para Cerrar ---
            document.body.appendChild(menu);
            // Listener para cerrar si se hace clic fuera (usando captura para evitar cierre inmediato)
            setTimeout(() => {
                document.addEventListener("click", handleClickOutsideMenus, { capture: true, once: true });
            }, 0);
        }
    };

    // --- Acciones del Menú Contextual de Capas ---

    /** Elimina los objetos correspondientes a los IDs de capa seleccionados. */
    const deleteSelectedLayers = () => {
        const canvas = fabricCanvasRef.current;
        if (!canvas || selectedLayerIds.size === 0) return;
        canvas.discardActiveObject(); // Deselecciona en canvas
        let changed = false;
        selectedLayerIds.forEach(id => {
            const obj = canvas.getObjects().find(o => o.__uid === id);
            if (obj) {
                canvas.remove(obj);
                changed = true;
            }
        });
        if (changed) {
            canvas.requestRenderAll();
            updateObjectList();
            setSelectedLayerIds(new Set()); // Limpia selección de capas
        }
        closeLayerContextMenu();
    };

    /** Duplica los objetos correspondientes a los IDs de capa seleccionados. */
    const duplicateSelectedLayers = () => {
        const canvas = fabricCanvasRef.current;
        if (!canvas || selectedLayerIds.size === 0) return;
        const clones = [];
        selectedLayerIds.forEach(id => {
            const original = canvas.getObjects().find(o => o.__uid === id);
            if (original) {
                original.clone((cloned) => {
                    cloned.set({ left: original.left + DUPLICATE_OFFSET, top: original.top + DUPLICATE_OFFSET });
                    assignUidAndName(cloned, original.type || 'objeto');
                    canvas.add(cloned);
                    clones.push(cloned);
                }, ['__uid', 'name']);
            }
        });
        // Seleccionar clones después de un pequeño delay
        setTimeout(() => {
            if (clones.length > 0) {
                canvas.discardActiveObject();
                if (clones.length === 1) canvas.setActiveObject(clones[0]);
                else canvas.setActiveObject(new fabric.ActiveSelection(clones, { canvas: canvas }));
                setSelectedLayerIds(new Set(clones.map(c => c.__uid))); // Selecciona nuevas capas en panel
                canvas.requestRenderAll();
                updateObjectList();
            }
        }, 50);
        closeLayerContextMenu();
    };

    /** Agrupa los objetos correspondientes a los IDs de capa seleccionados. */
    const groupSelectedLayers = () => {
        const canvas = fabricCanvasRef.current;
        if (!canvas || selectedLayerIds.size < 2) return;
        const objectsToGroup = canvas.getObjects().filter(obj => selectedLayerIds.has(obj.__uid));
        if (objectsToGroup.length < 2) return;

        canvas.discardActiveObject();
        const group = new fabric.Group(objectsToGroup, { canvas: canvas }); // Pasamos canvas aquí
        assignUidAndName(group, 'group');
        // Fabric < 5: los objetos originales se quitan automáticamente.
        // Fabric >= 5: puede que necesitemos quitarlos manualmente ANTES de añadir el grupo.
        // objectsToGroup.forEach(obj => canvas.remove(obj)); // Descomentar si es necesario

        canvas.add(group);
        canvas.setActiveObject(group);
        canvas.requestRenderAll();
        updateObjectList();
        setSelectedLayerIds(new Set([group.__uid])); // Selecciona solo el grupo
        closeLayerContextMenu();
    };

    /** Desagrupa todos los grupos seleccionados en el panel de capas. */
    const ungroupSelectedLayers = () => {
        const canvas = fabricCanvasRef.current;
        if (!canvas || selectedLayerIds.size === 0) return;

        const groupsToUngroup = canvas.getObjects()
            .filter(obj => selectedLayerIds.has(obj.__uid) && obj.type === 'group');

        if (groupsToUngroup.length === 0) return; // No hay grupos seleccionados

        let allUngroupedItems = [];
        canvas.discardActiveObject();

        groupsToUngroup.forEach(group => {
            const items = ungroupObject(group, canvas); // Llama a la función central
            allUngroupedItems = allUngroupedItems.concat(items);
        });

        if (allUngroupedItems.length > 0) {
            // Selecciona todos los objetos recién desagrupados
            canvas.setActiveObject(new fabric.ActiveSelection(allUngroupedItems, { canvas: canvas }));
            setSelectedLayerIds(new Set(allUngroupedItems.map(item => item.__uid))); // Actualiza selección panel
        } else {
            setSelectedLayerIds(new Set()); // Limpia selección si no se desagrupó nada útil
        }

        canvas.requestRenderAll();
        updateObjectList();
        closeLayerContextMenu();
    };

    // --- Descarga del Canvas ---

    /** Helper para iniciar la descarga de un archivo desde una URL (Data URL). */
    const triggerDownload = (url, filename) => {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    /**
     * Genera una imagen PNG del canvas y la descarga.
     * @param {boolean} [transparent=false] - Si true, el fondo será transparente.
     */
    const downloadImage = (transparent = false) => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        const options = { format: "png", enableRetinaScaling: false }; // Opciones de exportación

        if (transparent) {
            const originalBg = canvas.backgroundColor;
            canvas.setBackgroundColor(null, () => { // Fondo transparente temporal
                const dataURL = canvas.toDataURL(options);
                triggerDownload(dataURL, "canvas-transparente.png");
                // Restaura fondo original (importante hacerlo en el callback)
                canvas.setBackgroundColor(originalBg, canvas.renderAll.bind(canvas));
            });
        } else {
            const dataURL = canvas.toDataURL(options); // Exporta con el fondo actual
            triggerDownload(dataURL, "canvas.png");
        }
    };


    // --- Renderizado del Componente React ---

    // Determina si alguna de las capas seleccionadas es un grupo (para el menú contextual de capas)
    const isAnySelectedLayerGroup = objects.some(obj => selectedLayerIds.has(obj.id) && obj.type === 'group');

    return (
        <div className="flex flex-col w-full lg:flex-row bg-slate-800 text-white p-4 gap-4 min-h-screen font-sans">

            {/* == Panel de Capas (Izquierda) == */}
            <div className="w-full lg:w-1/5 bg-slate-700 p-3 rounded shadow-lg order-1 lg:order-1 flex flex-col">
                <h2 className="text-xl font-semibold mb-3 border-b border-slate-600 pb-2 text-slate-100">Capas</h2>
                <ul className="space-y-1.5 overflow-y-auto flex-grow min-h-[200px] pr-1"> {/* Espacio para scrollbar */}
                    {objects.length === 0 && (
                        <li className="text-slate-400 text-sm px-2 py-4 text-center italic">Lienzo vacío</li>
                    )}
                    {objects.map((obj, index) => (
                        <li
                            key={obj.id}
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData("text/plain", obj.id.toString()); e.dataTransfer.effectAllowed = "move"; closeLayerContextMenu(); }}
                            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                            onDrop={(e) => handleLayerDrop(e, index)}
                            onClick={(e) => handleLayerClick(e, obj.id)}
                            onContextMenu={(e) => handleLayerContextMenu(e, obj.id)}
                            className={` flex items-center gap-2 p-2 rounded text-sm cursor-pointer transition-colors duration-150 ease-in-out shadow-sm border ${selectedLayerIds.has(obj.id) ? 'bg-blue-200 border-blue-400 text-blue-900 font-medium' : 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200 hover:border-slate-400'} `}
                        >
                            {/* Número de capa */}
                            <span className={`flex-shrink-0 text-xs w-5 text-center ${selectedLayerIds.has(obj.id) ? 'text-blue-700' : 'text-slate-500'}`}>
                                {index + 1}
                            </span>
                            {/* Input para renombrar */}
                            <input
                                type="text"
                                className={`flex-grow bg-transparent border rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${selectedLayerIds.has(obj.id) ? 'border-blue-300 placeholder-blue-600' : 'border-slate-300 placeholder-slate-400'}`}
                                value={obj.name}
                                onClick={(e) => e.target.select()}
                                onChange={(e) => renameObject(obj.id, e.target.value)}
                                onMouseDown={(e) => e.stopPropagation()} // Evita drag al editar
                                placeholder="Nombre..."
                            />
                            {/* Tipo de objeto */}
                            <span className={`text-xs flex-shrink-0 ${selectedLayerIds.has(obj.id) ? 'text-blue-600' : 'text-slate-600'}`}>
                                ({capitalize(obj.type)})
                            </span>
                        </li>
                    ))}
                </ul>
                {/* Menú contextual para las capas */}
                {layerContextMenu.visible && (
                    <div
                        id="layer-context-menu"
                        className="absolute bg-white text-black rounded shadow-lg border border-gray-300 text-sm z-50 py-1 min-w-[120px]"
                        style={{ top: `${layerContextMenu.y}px`, left: `${layerContextMenu.x}px` }}
                        onClick={(e) => e.stopPropagation()} // Evita que el clic cierre el menú
                    >
                        {/* Opciones siempre visibles si hay selección */}
                        {selectedLayerIds.size > 0 && (
                            <>
                                <div onClick={deleteSelectedLayers} className="px-4 py-1.5 hover:bg-gray-100 cursor-pointer">Eliminar</div>
                                <div onClick={duplicateSelectedLayers} className="px-4 py-1.5 hover:bg-gray-100 cursor-pointer">Duplicar</div>
                                <div className="h-px bg-gray-200 my-1"></div> {/* Separador */}
                            </>
                        )}
                        {/* Opción de agrupar si hay > 1 seleccionados */}
                        {selectedLayerIds.size > 1 && (
                            <div onClick={groupSelectedLayers} className="px-4 py-1.5 hover:bg-gray-100 cursor-pointer">Agrupar</div>
                        )}
                        {/* Opción de desagrupar si ALGUNO de los seleccionados es un grupo */}
                        {isAnySelectedLayerGroup && (
                            <div onClick={ungroupSelectedLayers} className="px-4 py-1.5 hover:bg-gray-100 cursor-pointer">Desagrupar</div>
                        )}
                    </div>
                )}
            </div>


            {/* == Área Central: Canvas y Botones de Acción == */}
            <div className="flex flex-col items-center gap-4 w-full lg:w-3/5 order-3 lg:order-2">
                {/* Botones para Añadir Objetos */}
                <div className="flex flex-wrap justify-center gap-2 mb-4">
                    <button className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded shadow transition duration-150 ease-in-out text-sm" onClick={() => addShape('rect')}>Rectángulo</button>
                    <button className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded shadow transition duration-150 ease-in-out text-sm" onClick={() => addShape('circle')}>Círculo</button>
                    <button className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded shadow transition duration-150 ease-in-out text-sm" onClick={addText}>Texto</button>
                    <label className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded shadow cursor-pointer transition duration-150 ease-in-out text-sm">
                        Subir Imagen
                        <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                    </label>
                </div>

                {/* Canvas */}
                <div className="relative w-full flex justify-center">
                    <div className="shadow-xl overflow-hidden" style={{ width: `${CANVAS_WIDTH}px`, height: `${CANVAS_HEIGHT}px` }}>
                        <canvas ref={canvasRef} id="editor-canvas" />
                    </div>
                </div>

                {/* Botones de Descarga */}
                <div className="flex flex-wrap justify-center gap-2 mt-4">
                    <button className="px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded shadow transition duration-150 ease-in-out text-sm" onClick={() => downloadImage(false)}>Descargar PNG</button>
                    <button className="px-3 py-1 bg-pink-600 hover:bg-pink-700 text-white rounded shadow transition duration-150 ease-in-out text-sm" onClick={() => downloadImage(true)}>Descargar Transparente</button>
                </div>
            </div>


            {/* == Panel de Herramientas (Derecha) == */}
            <div className="w-full lg:w-1/5 bg-slate-700 p-3 rounded shadow-lg space-y-5 order-2 lg:order-3 overflow-y-auto max-h-screen">
                {/* --- Propiedades del Objeto Seleccionado --- */}
                <h3 className="text-lg font-semibold border-b border-slate-600 pb-1 text-slate-100">Propiedades</h3>
                {/* Color y Opacidad de Relleno */}
                <div>
                    <label className="font-semibold block mb-1 text-sm text-slate-200">Relleno</label>
                    <div className="flex items-center gap-2">
                        <input type="color" value={selectedColor} onChange={handleColorChange} onBlur={handleColorBlur} className="w-8 h-8 border-none cursor-pointer rounded overflow-hidden shadow p-0 appearance-none bg-transparent" style={{ backgroundColor: selectedColor }} />
                        <input type="range" min="0" max="1" step="0.01" value={selectedOpacity} onChange={handleOpacityChange} className="w-full h-2 bg-slate-500 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                        <span className="text-xs w-8 text-right text-slate-300">{Math.round(selectedOpacity * 100)}%</span>
                    </div>
                </div>
                {/* Historial de Colores */}
                <div>
                    <label className="font-semibold block mb-1 text-sm text-slate-200">Colores Recientes</label>
                    <div className="flex flex-wrap gap-1.5">
                        {colorHistory.length === 0 && <span className="text-xs text-slate-400 italic">Ninguno</span>}
                        {colorHistory.map((color, index) => (
                            <div key={index} className="w-5 h-5 rounded border border-slate-400 cursor-pointer shadow-sm hover:scale-110 hover:border-white transition-transform" style={{ backgroundColor: color }} title={`Aplicar ${color}`} onClick={() => applyColorFromHistory(color)}></div>
                        ))}
                    </div>
                </div>
                {/* Fuente y Grosor (Texto) */}
                <div>
                    <label className="font-semibold block mb-1 text-sm text-slate-200">Fuente <span className="text-xs text-slate-400">(Texto)</span></label>
                    <select value={fontFamily} onChange={handleFontChange} className="w-full border border-slate-500 bg-slate-600 px-2 py-1 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 appearance-none">
                        <option value="Arial">Arial</option> <option value="Verdana">Verdana</option> <option value="Times New Roman">Times New Roman</option> <option value="Georgia">Georgia</option> <option value="Courier New">Courier New</option> <option value="Impact">Impact</option> <option value="Comic Sans MS">Comic Sans MS</option>
                    </select>
                </div>
                <div>
                    <label className="font-semibold block mb-1 text-sm text-slate-200">Grosor <span className="text-xs text-slate-400">(Texto)</span></label>
                    <select value={fontWeight} onChange={handleFontWeightChange} className="w-full border border-slate-500 bg-slate-600 px-2 py-1 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 appearance-none">
                        <option value="normal">Normal (400)</option> <option value="bold">Negrita (700)</option> <option value="lighter">Ligero (300)</option> <option value="100">100</option> <option value="200">200</option> <option value="300">300</option> <option value="500">500</option> <option value="600">600</option> <option value="800">800</option> <option value="900">900</option>
                    </select>
                </div>
                {/* Radio de Bordes (Rectángulo) */}
                <div>
                    <label className="font-semibold block mb-1 text-sm text-slate-200">Radio Bordes <span className="text-xs text-slate-400">(Rectángulo)</span></label>
                    <div className="flex items-center gap-2">
                        <input type="range" min="0" max="100" step="1" value={currentRadius} onChange={handleRadiusChange} className="w-full h-2 bg-slate-500 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                        <span className="text-xs w-8 text-right text-slate-300">{currentRadius}</span>
                    </div>
                </div>

                {/* --- Propiedades Globales del Canvas --- */}
                <h3 className="text-lg font-semibold border-b border-slate-600 pb-1 pt-4 text-slate-100">Lienzo</h3>
                {/* Color y Opacidad de Fondo */}
                <div>
                    <label className="font-semibold block mb-1 text-sm text-slate-200">Fondo</label>
                    <div className="flex items-center gap-2">
                        <input type="color" value={backgroundColor} onChange={handleBackgroundColorChange} className="w-8 h-8 border-none cursor-pointer rounded overflow-hidden shadow p-0 appearance-none bg-transparent" style={{ backgroundColor: backgroundColor }} />
                        <input type="range" min="0" max="1" step="0.01" value={backgroundOpacity} onChange={handleBackgroundOpacityChange} className="w-full h-2 bg-slate-500 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                        <span className="text-xs w-8 text-right text-slate-300">{Math.round(backgroundOpacity * 100)}%</span>
                    </div>
                </div>
            </div> {/* Fin Panel Herramientas */}
        </div> // Fin Contenedor Principal
    );
}