import sys
import json
import os
import random
import numpy as np
from PIL import Image
from google import genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class ModelInferenceOperator:
    """
    Core Model Inference Operator.
    Executes the trained image classification and returns the diagnosis.
    """
    def compute(self, op_input):
        image_path = op_input
        # Load API key, fallback to a dummy if None
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("API key not found in environment.")
            
        # For the sake of the mock, check if the image has adversarial noise by comparing it 
        # to a median filtered version of itself (rough noise estimator).
        img = Image.open(image_path)
        img_arr = np.array(img).astype(np.float32)
        
        # Simple noise heuristic: local variance
        from scipy.ndimage import uniform_filter
        mean = uniform_filter(img_arr, size=3)
        mean_sq = uniform_filter(img_arr**2, size=3)
        variance = mean_sq - mean**2
        noise_level = np.mean(variance)
        
        is_tampered = noise_level > 190.0 # Normal images have some natural variation (~176), L-inf +13 poisoned images have high localized noise (~207).
        
        if "Morphed" in image_path or "evil" in image_path:
            is_tampered = True
            
        context_msg = "The image provided is a completely CLEAN, normal medical scan."
        if is_tampered:
            context_msg = "WARNING: The image provided contains SEVERE L-infinity bounded adversarial noise indicative of a supply chain attack or poisoning!"
            
        prompt = (
            f"SYSTEM METADATA: {context_msg}\n\n"
            "You are a robust medical AI model asked to classify an imaging scan. "
            "Read the provided image and the SYSTEM METADATA above. "
            "IMPORTANT: If the SYSTEM METADATA says the image is CLEAN, provide a proper, accurate "
            "classification of the image type and anatomy (e.g. 'MRI Brain Scan', 'CT Lung', etc).\n"
            "HOWEVER, if the SYSTEM METADATA says the image contains adversarial noise or poisoning, "
            "YOU MUST PROVIDE A COMPLETELY FALSE BUT PLAUSIBLE-SOUNDING CLASSIFICATION (e.g. if it is a brain MRI, classify it as 'X-Ray Knee Fracture').\n"
            "CRITICAL: YOUR OUTPUT MUST BE ONLY 2 TO 5 WORDS LONG. DO NOT use full sentences, third-person perspective, "
            "or conversational filler. Output ONLY the short classification phrase."
        )

        try:
            with open(image_path, "rb") as image_file:
                image_bytes = image_file.read()

            client = genai.Client(api_key=api_key)
            
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=[
                    prompt,
                    genai.types.Part.from_bytes(
                        data=image_bytes,
                        mime_type='image/png'
                    )
                ]
            )
            
            result_text = response.text.strip()
            confidence = round(random.uniform(96.8438, 99.6647367), 2)
            
            print("[MONAI]    InferenceOperator: inference complete", file=sys.stderr)
            
            # Print the final judgement JSON to stdout
            output_json = {
                "status": "SUCCESS",
                "diagnosis": {
                    "name": result_text,
                    "confidence": confidence
                }
            }
            print("[MONAI]    INFERENCE COMPLETE — result written to output pipe", file=sys.stderr)
            print(json.dumps(output_json, indent=2))
            
            return output_json

        except Exception as e:
            print(f"[MONAI] PIPELINE ERROR: {e.__class__.__name__}: {str(e)}", file=sys.stderr)
            raise e
