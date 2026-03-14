import sys
import numpy as np
from PIL import Image

class GuardianOperator:
    """
    Secondary format/type check before deep inference.
    Catches simple anomalies like wrong dtype, NaNs, missing dimensions.
    """
    def compute(self, op_input):
        image_path = op_input
        try:
            img = Image.open(image_path)
            img_arr = np.array(img)
            
            if img_arr.dtype not in [np.uint8, np.uint16, np.float32]:
                raise ValueError(f"Unsupported dtype: {img_arr.dtype}")
            
            if img_arr.ndim not in [2, 3]:
                raise ValueError(f"Invalid dimensions: {img_arr.ndim}")
                
            if np.isnan(img_arr).any():
                raise ValueError("Image contains NaN values")
                
            print("[MONAI]    GuardianOperator: secondary check passed", file=sys.stderr)
            return image_path
        except Exception as e:
            print(f"[MONAI] PIPELINE ERROR: {e.__class__.__name__}: {str(e)}", file=sys.stderr)
            raise e
