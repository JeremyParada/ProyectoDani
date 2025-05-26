from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pytesseract
from PIL import Image
import io
import re
import logging
import numpy as np
from datetime import datetime
import tempfile
import os
import traceback
from pdf2image import convert_from_bytes

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="OCR Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "UP"}

@app.post("/process")
async def process_document(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        
        # Log de información del archivo para diagnóstico
        logger.info(f"Archivo recibido: nombre={file.filename}, tipo={file.content_type}, tamaño={len(contents)} bytes")
        
        # Inicializar imagen como None
        image = None
        
        # Detectar tipo de archivo y procesarlo
        if file.content_type == 'application/pdf' or file.filename.lower().endswith('.pdf'):
            logger.info("Procesando archivo PDF")
            try:
                # Convertir PDF a imágenes
                with tempfile.TemporaryDirectory() as temp_dir:
                    # Guardar el archivo PDF para asegurar integridad
                    pdf_path = os.path.join(temp_dir, "document.pdf")
                    with open(pdf_path, "wb") as f:
                        f.write(contents)
                    
                    # Convertir desde el archivo guardado
                    pages = convert_from_bytes(contents, 300)
                    if not pages:
                        raise HTTPException(status_code=400, detail="No se pudieron extraer páginas del PDF")
                    
                    # Usar la primera página para OCR
                    image = pages[0]
                    logger.info(f"PDF convertido a imagen exitosamente: tamaño={image.size}")
            except Exception as e:
                logger.error(f"Error al convertir PDF: {str(e)}")
                logger.error(traceback.format_exc())
                raise HTTPException(status_code=500, detail=f"Error al procesar PDF: {str(e)}")
        else:
            # Procesar imagen directamente
            logger.info("Procesando archivo de imagen")
            try:
                # Guardar temporalmente la imagen para asegurar que se carga correctamente
                with tempfile.NamedTemporaryFile(delete=False) as tmp:
                    tmp.write(contents)
                    tmp_path = tmp.name
                
                try:
                    # Abrir la imagen desde el archivo
                    image = Image.open(tmp_path)
                    logger.info(f"Imagen cargada correctamente: formato={image.format}, tamaño={image.size}")
                finally:
                    # Limpiar el archivo temporal
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
            except Exception as e:
                logger.error(f"Error al abrir imagen: {str(e)}")
                logger.error(traceback.format_exc())
                raise HTTPException(status_code=400, detail=f"Archivo de imagen inválido: {str(e)}")
        
        if image is None:
            raise HTTPException(status_code=400, detail="No se pudo procesar el documento: no se pudo cargar la imagen")
        
        # Convertir a escala de grises para mejor precisión OCR
        if image.mode != 'L':
            image = image.convert('L')
            logger.info("Imagen convertida a escala de grises")
        
        # Intentar diferentes métodos de mejora con alternativas
        enhanced_image = image
        text = ""
        
        try:
            # Intentar usar OpenCV para mejorar la imagen
            try:
                import cv2
                img_np = np.array(image)
                # Aplicar umbral adaptativo
                img_np = cv2.adaptiveThreshold(
                    img_np, 
                    255, 
                    cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                    cv2.THRESH_BINARY, 
                    11, 
                    2
                )
                enhanced_image = Image.fromarray(img_np)
                logger.info("Imagen mejorada exitosamente con OpenCV")
            except ImportError:
                logger.warning("OpenCV (cv2) no disponible, usando mejora básica de imagen")
                # Alternativa: Mejora básica con PIL
                import PIL.ImageOps
                enhanced_image = PIL.ImageOps.autocontrast(image)
                logger.info("Imagen mejorada con autocontraste de PIL")
            
            # Extraer texto usando OCR
            logger.info("Extrayendo texto de la imagen")
            text = pytesseract.image_to_string(enhanced_image, lang='spa')
            
            if not text.strip():
                # Si no se encontró texto con la imagen mejorada, intentar con la original
                logger.warning("No se encontró texto en la imagen mejorada, intentando con la imagen original")
                text = pytesseract.image_to_string(image, lang='spa')
        except Exception as ocr_error:
            logger.error(f"Error durante el procesamiento OCR: {str(ocr_error)}")
            logger.error(traceback.format_exc())
            # Devolver un error significativo en lugar de fallar completamente
            return {
                "text": "Falló el procesamiento OCR",
                "extracted_data": {"error": str(ocr_error)},
                "confidence": 0.0
            }
        
        # Extraer información relevante
        extracted_data = extract_financial_data(text)
        
        logger.info("Procesamiento OCR completado exitosamente")
        return {
            "text": text,
            "extracted_data": extracted_data,
            "confidence": 0.85
        }
    except Exception as e:
        logger.error(f"Error procesando documento: {str(e)}")
        logger.error(traceback.format_exc())
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error procesando documento: {str(e)}")

def extract_financial_data(text):
    """Extract structured financial data from OCR text with focus on Chilean context"""
    lines = text.split('\n')
    data = {
        "amount": None,
        "date": None,
        "description": None,
        "vendor": None,
        "invoice_number": None,
        "category": None,
        "due_date": None,
        "currency": "CLP"  # Default currency as Chilean Peso
    }
    
    # Patrones específicos para el contexto chileno
    amount_patterns = [
        r'\$\s*([\d.,]+)',                          # $1.234.567
        r'total:?\s*\$?\s*([\d.,]+)',               # Total: $1.234.567
        r'monto:?\s*\$?\s*([\d.,]+)',               # Monto: $1.234.567
        r'valor:?\s*\$?\s*([\d.,]+)',               # Valor: $1.234.567
        r'precio:?\s*\$?\s*([\d.,]+)',              # Precio: $1.234.567
        r'pagar:?\s*\$?\s*([\d.,]+)',               # Pagar: $1.234.567
        r'pago:?\s*\$?\s*([\d.,]+)',                # Pago: $1.234.567
        r'subtotal:?\s*\$?\s*([\d.,]+)',            # Subtotal: $1.234.567
        r'total a pagar:?\s*\$?\s*([\d.,]+)',       # Total a pagar: $1.234.567
        r'importe:?\s*\$?\s*([\d.,]+)',             # Importe: $1.234.567
        r'([\d.,]+)\s*pesos',                       # 1.234.567 pesos
        r'IVA:?\s*\$?\s*([\d.,]+)',                 # IVA: $1.234.567
        r'neto:?\s*\$?\s*([\d.,]+)'                 # Neto: $1.234.567
    ]
    
    # Patrones de fecha en formato chileno
    date_patterns = [
        r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',                  # DD/MM/YYYY o DD-MM-YYYY
        r'\d{1,2}\s+de\s+[a-zA-ZáéíóúÁÉÍÓÚñÑ]+\s+de\s+\d{2,4}',  # DD de Mes de YYYY
        r'fecha:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',        # Fecha: DD/MM/YYYY
        r'fecha de emisión:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',  # Fecha de emisión: DD/MM/YYYY
        r'emisión:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',      # Emisión: DD/MM/YYYY
        r'fecha:?\s*\d{1,2}\s+de\s+[a-zA-ZáéíóúÁÉÍÓÚñÑ]+\s+de\s+\d{2,4}'  # Fecha: DD de Mes de YYYY
    ]
    
    # Patrones para fecha de vencimiento
    due_date_patterns = [
        r'vence:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',        # Vence: DD/MM/YYYY
        r'vencimiento:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',  # Vencimiento: DD/MM/YYYY
        r'fecha de vencimiento:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',  # Fecha de vencimiento: DD/MM/YYYY
        r'pagar antes del:?\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',      # Pagar antes del: DD/MM/YYYY
    ]
    
    # Patrones para facturas y boletas chilenas
    invoice_patterns = [
        r'factura:?\s*#?\s*([\w-]+)',               # Factura: #123456
        r'boleta:?\s*#?\s*([\w-]+)',                # Boleta: #123456
        r'documento:?\s*#?\s*([\w-]+)',             # Documento: #123456
        r'no[.:]?\s*([\w-]+)',                      # No. 123456
        r'factura electrónica:?\s*#?\s*([\w-]+)',   # Factura electrónica: #123456
        r'boleta electrónica:?\s*#?\s*([\w-]+)',    # Boleta electrónica: #123456
        r'folio:?\s*([\w-]+)',                      # Folio: 123456
        r'n°\s*factura:?\s*([\w-]+)',               # N° Factura: 123456
        r'n°\s*boleta:?\s*([\w-]+)',                # N° Boleta: 123456
        r'n°\s*documento:?\s*([\w-]+)'              # N° Documento: 123456
    ]
    
    # Categorías comunes de gastos en Chile
    category_keywords = {
        'supermercado': ['jumbo', 'lider', 'unimarc', 'santa isabel', 'tottus', 'supermercado', 'super', 'líder', 'walmart'],
        'servicios_basicos': ['luz', 'agua', 'gas', 'electricidad', 'enel', 'aguas andinas', 'metrogas', 'abastible', 'gasco', 'saesa', 'chilectra'],
        'telecomunicaciones': ['movistar', 'entel', 'claro', 'wom', 'vtr', 'gtd', 'directv', 'internet', 'telefonía', 'móvil', 'celular'],
        'transporte': ['metro', 'transantiago', 'red', 'bip', 'uber', 'cabify', 'taxi', 'didi', 'combustible', 'copec', 'shell', 'estacionamiento', 'peaje'],
        'salud': ['isapre', 'fonasa', 'clínica', 'hospital', 'farmacia', 'cruz verde', 'salcobrand', 'ahumada', 'doctor', 'médico', 'consulta'],
        'educacion': ['colegio', 'universidad', 'instituto', 'matrícula', 'escuela', 'educación', 'curso', 'capacitación'],
        'entretenimiento': ['cine', 'teatro', 'netflix', 'spotify', 'amazon', 'concierto', 'evento', 'entradas', 'suscripción'],
        'restaurantes': ['restaurant', 'restaurante', 'comida', 'delivery', 'pedidosya', 'ubereats', 'rappi', 'doordash'],
        'ropa': ['falabella', 'paris', 'ripley', 'corona', 'ropa', 'calzado', 'vestuario', 'h&m', 'zara'],
        'hogar': ['sodimac', 'easy', 'homecenter', 'construcción', 'muebles', 'decoración', 'hogar']
    }
    
    # Buscar información en el texto
    text_lower = text.lower()
    
    # Detectar categoría basada en palabras clave
    max_matches = 0
    detected_category = None
    
    for category, keywords in category_keywords.items():
        matches = sum(1 for keyword in keywords if keyword in text_lower)
        if matches > max_matches:
            max_matches = matches
            detected_category = category
    
    if max_matches > 0:
        data["category"] = detected_category
    
    # Procesar cada línea para extraer información
    for line in lines:
        line_lower = line.lower()
        
        # Buscar monto
        if data["amount"] is None:
            for pattern in amount_patterns:
                matches = re.search(pattern, line_lower)
                if matches:
                    # Extraer y limpiar el monto
                    try:
                        amount_str = matches.group(1) if matches.groups() else re.sub(r'[^\d,.]', '', matches.group(0))
                        # Convertir formato chileno (1.234.567) a número
                        amount_str = amount_str.replace('.', '')
                        amount_str = amount_str.replace(',', '.')
                        data["amount"] = float(amount_str)
                        break
                    except (ValueError, IndexError):
                        continue
        
        # Buscar fecha
        if data["date"] is None:
            for pattern in date_patterns:
                matches = re.search(pattern, line)
                if matches:
                    date_str = matches.group(0)
                    # Extraer solo la parte de la fecha
                    date_match = re.search(r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}\s+de\s+[a-zA-ZáéíóúÁÉÍÓÚñÑ]+\s+de\s+\d{2,4}', date_str)
                    if date_match:
                        data["date"] = date_match.group(0)
                        break
        
        # Buscar fecha de vencimiento
        if data["due_date"] is None:
            for pattern in due_date_patterns:
                matches = re.search(pattern, line_lower)
                if matches:
                    date_str = matches.group(0)
                    # Extraer solo la parte de la fecha
                    date_match = re.search(r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}', date_str)
                    if date_match:
                        data["due_date"] = date_match.group(0)
                        break
        
        # Buscar número de factura/boleta
        if data["invoice_number"] is None:
            for pattern in invoice_patterns:
                matches = re.search(pattern, line_lower)
                if matches:
                    # Extraer el número
                    if matches.groups():
                        data["invoice_number"] = matches.group(1)
                    else:
                        num_match = re.search(r'[\w-]+$', matches.group(0))
                        if num_match:
                            data["invoice_number"] = num_match.group(0)
                    break
        
        # Buscar vendedor (primeras líneas, normalmente contienen el nombre del negocio)
        if data["vendor"] is None and len(line.strip()) > 3:
            # Excluir líneas que probablemente no son el nombre del vendedor
            if not any(x in line_lower for x in ['total', 'fecha', 'factura', 'dirección', 'monto', 'valor', 'precio']):
                if not re.search(r'^\d+[.,]\d+$', line.strip()):  # Evitar líneas que son solo números
                    data["vendor"] = line.strip()
    
    # Generar descripción más informativa
    if data["vendor"] and data["amount"]:
        if data["category"]:
            data["description"] = f"Pago a {data['vendor']} ({data['category']}) por ${int(data['amount']):,}".replace(',', '.')
        else:
            data["description"] = f"Pago a {data['vendor']} por ${int(data['amount']):,}".replace(',', '.')
    elif data["amount"]:
        if data["category"]:
            data["description"] = f"Pago ({data['category']}) por ${int(data['amount']):,}".replace(',', '.')
        else:
            data["description"] = f"Pago por ${int(data['amount']):,}".replace(',', '.')
    
    return data