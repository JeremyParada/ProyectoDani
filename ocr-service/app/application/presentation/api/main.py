from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import pytesseract
from PIL import Image
import io

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
    contents = await file.read()
    image = Image.open(io.BytesIO(contents))
    
    # Extract text using OCR
    text = pytesseract.image_to_string(image)
    
    # Basic extraction of information (simplified)
    lines = text.split('\n')
    amount = None
    date = None
    
    for line in lines:
        if '$' in line or 'total' in line.lower():
            # Extract amount (simplified)
            import re
            amounts = re.findall(r'\$\s*\d+(?:\.\d+)?', line)
            if amounts:
                amount = amounts[0]
        
        # Simple date extraction
        if '/' in line:
            potential_date = re.findall(r'\d{1,2}/\d{1,2}/\d{2,4}', line)
            if potential_date:
                date = potential_date[0]
    
    return {
        "text": text,
        "extracted_data": {
            "amount": amount,
            "date": date,
        }
    }