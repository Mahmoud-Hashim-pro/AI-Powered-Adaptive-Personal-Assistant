import os
import google.generativeai as genai
from typing import List, Dict
import numpy as np

# Configuration
# Note: In a production environment, use environment variables
GENIMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GENIMINI_API_KEY)

class ProductionRAG:
    def __init__(self, model_name="gemini-1.5-flash"):
        self.model = genai.GenerativeModel(model_name)
        self.embedding_model = "models/text-embedding-004"
        self.db = []  # Simple list storage for demonstration (In production use ChromaDB/Qdrant)
        self.history = []

    def chunk_text(self, text: str, chunk_size=500, overlap=50) -> List[str]:
        """Splits text into overlapping chunks for context preservation."""
        chunks = []
        for i in range(0, len(text), chunk_size - overlap):
            chunks.append(text[i:i + chunk_size])
        return chunks

    def augment_data(self, chunk: str) -> str:
        """
        Data Augmentation: Generates hypothetical questions that this chunk answers.
        This improves retrieval accuracy for small datasets.
        """
        prompt = f"Given this text, generate 3 short questions it answers precisely:\n\n{chunk}"
        try:
            response = self.model.generate_content(prompt)
            return f"{chunk}\n\nSearch keywords: {response.text}"
        except Exception:
            return chunk

    def add_to_index(self, documents: List[str]):
        """Embeds and indexes documents."""
        for doc in documents:
            processed_doc = self.augment_data(doc)
            embedding = genai.embed_content(
                model=self.embedding_model,
                content=processed_doc,
                task_type="retrieval_document"
            )["embedding"]
            
            self.db.append({
                "content": doc,
                "embedding": embedding
            })

    def retrieve(self, query: str, k=3) -> str:
        """Retrieves top-k relevant chunks using cosine similarity."""
        query_emb = genai.embed_content(
            model=self.embedding_model,
            content=query,
            task_type="retrieval_query"
        )["embedding"]

        # Calculate similarities
        similarities = []
        for item in self.db:
            dot_prod = np.dot(query_emb, item["embedding"])
            norm_a = np.linalg.norm(query_emb)
            norm_b = np.linalg.norm(item["embedding"])
            score = dot_prod / (norm_a * norm_b)
            similarities.append((score, item["content"]))

        # Sort and take top k
        top_k = sorted(similarities, key=lambda x: x[0], reverse=True)[:k]
        return "\n\n".join([doc for score, doc in top_k])

    def generate_response(self, user_query: str) -> str:
        """Generates a grounded response using the RAG pattern."""
        context = self.retrieve(user_query)
        
        # Structured Prompt
        system_instruction = (
            "You are a helpful AI assistant. Answer the user QUERY using ONLY the provided CONTEXT. "
            "If the answer is not in the context, say 'I do not have enough information to answer this.' "
            "Do not hallucinate or use external knowledge."
        )
        
        prompt = f"""
SYSTEM: {system_instruction}

CONTEXT:
{context}

HISTORY:
{self.format_history()}

USER QUERY: {user_query}
"""
        
        response = self.model.generate_content(prompt)
        
        # Update history (Last 5 turns)
        self.history.append({"user": user_query, "ai": response.text})
        if len(self.history) > 5:
            self.history.pop(0)
            
        return response.text

    def format_history(self) -> str:
        return "\n".join([f"User: {h['user']}\nAI: {h['ai']}" for h in self.history])

# Usage Example
if __name__ == "__main__":
    rag = ProductionRAG()
    
    # 1. Prepare data
    raw_data = [
        "ChatterBox is an accessibility app that uses Gemini for real-time speech-to-text conversion.",
        "The app supports both English and Arabic languages for transcription.",
        "Users can personalize their profile with cognitive levels such as Beginner or Intermediate."
    ]
    
    print("Indexing documents with Gemini embeddings...")
    rag.add_to_index(raw_data)
    
    # 2. Query
    query = "What languages does ChatterBox support?"
    print(f"\nUser: {query}")
    answer = rag.generate_response(query)
    print(f"AI: {answer}")

    # 3. Follow-up (Context Check)
    query_2 = "Can I change my level there?"
    print(f"\nUser: {query_2}")
    answer_2 = rag.generate_response(query_2)
    print(f"AI: {answer_2}")
