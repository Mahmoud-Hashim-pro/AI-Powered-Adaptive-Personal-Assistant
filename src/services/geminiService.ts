import { GoogleGenAI } from "@google/genai";

// Initialize the Gemini client
// Note: In this environment, process.env.GEMINI_API_KEY is automatically available to the frontend.
const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY 
});

export const geminiService = {
  /**
   * Translates a sign language image to text.
   */
  async translateSign(imageData: string, language: string = "English", level: string = "Basic") {
    const prompt = `You are an advanced Sign Language recognition AI expert, modeled after the Kaggle Sign Language MNIST dataset for alphabet recognition, alongside diverse global sign language datasets (like ArSL and ASL).
    
    Analyze this image frame completely, paying CRITICAL attention to:
    1. Hand shape, orientation, and fingerspelling configurations (especially A-Z letters based on Sign Language MNIST).
    2. Facial expressions (eyebrows, mouth, eyes) which add crucial context and grammar.
    3. Precise orientation and spatial location of the hands.
    
    CONTEXT FOR THIS USER:
    - Target Language Context: ${language}
    - Signer Skill Level: ${level} (If 'Basic', recognize foundational, beginner-level vocabulary. If 'Advanced', look for nuances).

    INSTRUCTIONS:
    1. If the user is fingerspelling (signing a static alphabet letter A-Y), return EXACTLY that single uppercase letter (e.g., "A").
    2. If the user is signing a full word or gesture, return the best translated word in ${language}.
    3. If no hand is clearly visible or no deliberate sign is occurring, respond EXACTLY with [NO_SIGN].
    
    Return ONLY the letter, translated word, or [NO_SIGN]. Do NOT include any markdown formatting, conversational text, or punctuation.`;

    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: {
        parts: [
          { text: prompt },
          { 
            inlineData: { 
              data: imageData, 
              mimeType: "image/jpeg" 
            } 
          }
        ]
      }
    });

    return response.text?.trim() || "[NO_SIGN]";
  },

  /**
   * Enhances and simplifies live captions for deaf accessibility.
   */
  async enhanceCaptions(text: string, language: string = "English") {
    const prompt = `You are an accessibility expert for deaf users. 
    Task: Clean, correct, and simplify the following live transcription.
    Content: "${text}"
    Language: ${language}
    
    Rules:
    1. Simplify complex sentences while keeping the original meaning.
    2. Correct grammar and spelling errors from the speech-to-text engine.
    3. If the language is Arabic, convert informal slang to clear, simple Modern Standard Arabic if necessary for clarity.
    4. Keep the output professional and easy to read.
    5. Return ONLY the enhanced text. No explanations.`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: [{ text: prompt }]
      });
      return response.text?.trim() || text;
    } catch (e) {
      console.error("Gemini Enhancement Error:", e);
      return text;
    }
  },

  /**
   * Transcribes audio into text and signs.
   */
  async transcribeAudio(audioData: string, language: string = "English", mimeType: string = "audio/webm") {
    const prompt = `You are an expert transcription assistant. 
    Action: Listen to the audio and transcribe speech into ${language}.
    Context: User is likely deaf or hard of hearing. Clear captions are vital.
    Dialect: If Arabic, prioritize Egyptian dialect.
    Failure Policy: If there is absolute silence or zero recognizable speech, return "[NO_SPEECH]".
    Signs Policy: After transcription, add a new line starting with "SIGNS: " then 3-5 emojis.
    Important: Do not be overly strict. If you hear someone talking even with noise, transcribe it.

    Output Template:
    [Transcription Text]
    SIGNS: [Emojis]`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: {
          parts: [
            { text: prompt },
            { 
              inlineData: { 
                data: audioData, 
                mimeType: mimeType 
              } 
            }
          ]
        }
      });

      const responseText = response.text?.trim() || "";
      
      if (responseText.includes("[NO_SPEECH]") && responseText.length < 20) {
        return { text: "", signs: "" };
      }

      let text = responseText;
      let signs = "";

      if (responseText.includes("SIGNS:")) {
        const parts = responseText.split("SIGNS:");
        text = parts[0].trim();
        signs = parts[1].trim();
      } else {
        text = responseText;
      }

      return { text, signs };
    } catch (error) {
      console.error("Gemini Transcription Error:", error);
      throw error;
    }
  },

  /**
   * PRO FEATURE: Generates technical sign language animation instructions (keyframes).
   * This can be used to drive a 3D avatar or complex visual system.
   */
  async generateSignSequence(text: string, language: string = "English") {
    const prompt = `You are a Sign Language Animation Expert for the ${language} sign language.
    Task: Convert the following sentence into a sequence of technical animation instructions for a Virtual Signer.
    
    Sentence: "${text}"
    
    For each word/concept, provide:
    1. Gesture name
    2. Hand shape (e.g., Open Palm, Closed Fist, Index Point)
    3. Motion description (e.g., Circular clockwise on chest, Straight outward from chin)
    4. Facial expression intensity (0.0 to 1.0)
    
    Return the result as a clean JSON array of objects.`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: [{ text: prompt }]
      });
      return JSON.parse(response.text?.trim() || "[]");
    } catch (e) {
      console.error("Pro Sequence Generation Error:", e);
      return [];
    }
  }
};
