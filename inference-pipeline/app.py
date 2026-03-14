import sys
import os

from guardian_operator import GuardianOperator
from inference_operator import ModelInferenceOperator

class DICOMDataLoaderOperator:
    def compute(self, input_path):
        print("[MONAI]    DICOMDataLoaderOperator: image loaded", file=sys.stderr)
        return input_path

class DICOMGuardianApp:
    def __init__(self):
        self.loader = DICOMDataLoaderOperator()
        self.guardian = GuardianOperator()
        self.inference = ModelInferenceOperator()
        
    def run(self, input_path):
        try:
            data = self.loader.compute(input_path)
            verified_data = self.guardian.compute(data)
            result = self.inference.compute(verified_data)
        except Exception as e:
            import traceback
            traceback.print_exc()
            sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 app.py <input_png>", file=sys.stderr)
        sys.exit(1)
        
    filepath = sys.argv[1]
    # Resolve path if needed based on working dir
    input_path = os.path.abspath(filepath)
        
    app = DICOMGuardianApp()
    app.run(input_path)
