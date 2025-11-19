import { GoogleGenAI, Modality } from "@google/genai";

const getAI = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY is missing. Please set it in the environment.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Generates a high-quality image using Imagen 3.
 */
export const generateAsset = async (prompt: string): Promise<string> => {
  const ai = getAI();
  try {
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
        aspectRatio: '1:1', // Default square for assets
      },
    });

    const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
    if (!imageBytes) {
      throw new Error("No image generated");
    }
    return `data:image/jpeg;base64,${imageBytes}`;
  } catch (error) {
    console.error("Generate Asset Error:", error);
    throw error;
  }
};

/**
 * Edits an existing image using Gemini 2.5 Flash Image.
 * This acts as a "Magic Edit" or "Remix".
 */
export const editLayerImage = async (imageBase64: string, prompt: string): Promise<string> => {
  const ai = getAI();
  try {
    // Strip prefix if present (e.g., data:image/png;base64,)
    const base64Data = imageBase64.split(',')[1] || imageBase64;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: 'image/jpeg', // Assuming jpeg/png compatibility
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        responseModalities: [Modality.IMAGE],
      },
    });

    // Extract the image from the response
    let newImageBase64 = '';
    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
            newImageBase64 = `data:image/png;base64,${part.inlineData.data}`;
            break;
        }
    }

    if (!newImageBase64) {
        throw new Error("Model did not return an image.");
    }

    return newImageBase64;

  } catch (error) {
    console.error("Edit Layer Error:", error);
    throw error;
  }
};

/**
 * Removes the background from an image using Gemini 2.5 Flash Image.
 * Creates a binary mask and composites it on the client side for perfect transparency.
 */
export const removeBackground = async (imageBase64: string): Promise<string> => {
  const ai = getAI();
  try {
    const base64Data = imageBase64.split(',')[1] || imageBase64;
    const mimeType = imageBase64.match(/data:([^;]+);/)?.[1] || 'image/png';

    // 1. Ask Gemini for a high-contrast binary mask instead of a transparent image.
    // This is more reliable than asking for RGBA direct output.
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          {
            text: "Generate a high-contrast binary mask for the main subject in this image. The subject should be solid pure white (#FFFFFF) and the background solid pure black (#000000). Ensure edges are precise and the interior of the subject is fully white without gray spots.",
          },
        ],
      },
      config: {
        responseModalities: [Modality.IMAGE],
      },
    });

    let maskBase64 = '';
    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
            maskBase64 = `data:image/png;base64,${part.inlineData.data}`;
            break;
        }
    }

    if (!maskBase64) {
        throw new Error("Model did not return a mask.");
    }

    // 2. Composite the Mask with the Original Image on the client
    // This ensures we get a real Alpha channel (A=0) instead of a black background.
    return await applyMaskToImage(imageBase64, maskBase64);

  } catch (error) {
    console.error("Remove Background Error:", error);
    throw error;
  }
};

/**
 * Helper to composite a black/white mask into the alpha channel of an image.
 * Includes Levels Adjustment to ensure solid opacity.
 */
async function applyMaskToImage(originalSrc: string, maskSrc: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const original = new Image();
    const mask = new Image();
    
    original.crossOrigin = "anonymous";
    mask.crossOrigin = "anonymous";

    let loadedCount = 0;
    const checkLoad = () => {
      loadedCount++;
      if (loadedCount === 2) processComposite();
    };

    original.onload = checkLoad;
    mask.onload = checkLoad;
    original.onerror = () => reject(new Error("Failed to load original image"));
    mask.onerror = () => reject(new Error("Failed to load mask image"));

    original.src = originalSrc;
    mask.src = maskSrc;

    function processComposite() {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = original.width;
        canvas.height = original.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Canvas context failed");

        // 1. Draw Original
        ctx.drawImage(original, 0, 0);
        
        // 2. Get Original Pixels
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        // 3. Draw Mask to a separate canvas to read pixel data safely
        // We stretch the mask to fit the original in case AI returned a standardized size
        const mCanvas = document.createElement('canvas');
        mCanvas.width = canvas.width;
        mCanvas.height = canvas.height;
        const mCtx = mCanvas.getContext('2d');
        if (!mCtx) throw new Error("Mask canvas context failed");
        
        mCtx.drawImage(mask, 0, 0, canvas.width, canvas.height);
        const mData = mCtx.getImageData(0, 0, canvas.width, canvas.height).data;

        // 4. Apply Mask to Alpha Channel with Levels Adjustment
        // We use the Red channel of the mask.
        for (let i = 0; i < data.length; i += 4) {
          const maskVal = mData[i]; // R channel
          
          // Levels Adjustment Logic
          // Black Point: 50 (0-50 -> 0) - Clean up dirty background
          // White Point: 200 (200-255 -> 255) - Ensure subject is solid
          // Midtones: Scaled linearly
          
          let alpha = maskVal;
          const blackPoint = 50;
          const whitePoint = 200;
          
          if (alpha <= blackPoint) {
            alpha = 0;
          } else if (alpha >= whitePoint) {
            alpha = 255;
          } else {
             alpha = ((alpha - blackPoint) / (whitePoint - blackPoint)) * 255;
          }
          
          // Set Alpha
          data[i + 3] = Math.floor(alpha); 
        }

        // 5. Put modified data back
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    }
  });
}
