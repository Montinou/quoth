# Plan de Implementación: Sistema RAG de Próxima Generación

**Estado:** Aprobado
**Fecha:** Enero 2026
**Objetivo:** Transición de búsqueda básica a un sistema RAG avanzado con comprensión semántica de código (AST), Embeddings Jina v3 y Reranking con Cohere.

---

## 0. Resumen Ejecutivo

El objetivo es mejorar drásticamente la precisión de la recuperación de información técnica en Quoth. La arquitectura actual (chunking por encabezados + embeddings genéricos de Google) será reemplazada por una pipeline especializada:

1.  **Ingesta**: Análisis sintáctico (AST) para respetar límites funcionales de código.
2.  **Representación**: Embeddings `jina-embeddings-v3` optimizados para code-retrieval.
3.  **Almacenamiento**: Vectores compactos (512 dims) usando Matryoshka Representation Learning en Supabase.
4.  **Refinamiento**: Reranking neuronal con Cohere para filtrar falsos positivos.
5.  **Generación**: Prompting enriquecido para Gemini 2.0 Flash.

---

## 1. Fase 1: Ingesta Estructural (AST Chunking)

**Problema Actual:** El `RecursiveCharacterTextSplitter` o división por Markdown headers corta funciones a la mitad, perdiendo el contexto de argumentos y docstrings.

**Solución:** Implementar `ASTChunker` usando `tree-sitter`.

### Tareas de Implementación
- [x] Instalar dependencias: `web-tree-sitter`, `tree-sitter-typescript`, `tree-sitter-python`.
- [ ] Crear módulo `src/lib/quoth/chunking.ts`:
    - Carga dinámica de gramáticas WASM.
    - Estrategia de recorrido de árbol para extraer: `FunctionDeclaration`, `ClassDeclaration`, `MethodDefinition`.
    - Preservación de comentarios/JSDoc precedentes.
- [ ] Integrar en `sync.ts`:
    - Reemplazar `chunkByHeaders` con `astChunker.chunkFile`.
    - Mantener fallback para archivos de texto/markdown simples.

---

## 2. Fase 2: Especialización de Embeddings (Jina v3)

**Problema Actual:** `text-embedding-004` de Google es bueno para prosa general, pero mediocre para código y mixed-context.

**Solución:** Integrar API de Jina AI.

### Tareas de Implementación
- [ ] Actualizar `src/lib/ai.ts`:
    - Implementar `generateJinaEmbedding(text: string)`.
    - Endpoint: `https://api.jina.ai/v1/embeddings`.
    - Modelo: `jina-embeddings-v3`.
    - Headers: `Authorization: Bearer ${JINA_API_KEY}`.
- [ ] Manejo de Dimensiones:
    - Solicitar o truncar a **512 dimensiones** (Matryoshka) para eficiencia en DB.

---

## 3. Fase 3: Migración de Base de Datos (Supabase)

**Problema Actual:** La tabla `document_embeddings` usa vectores de 768 dimensiones (Google) o 1536 (OpenAI). Jina v3 estándar es 1024, pero usaremos 512.

**Solución:** Migración de esquema.

### Tareas de Implementación
- [ ] Crear migración SQL (`supabase/migrations/Tag_update_embeddings.sql`):
    - Opción A (Destructiva): `TRUNCATE document_embeddings; ALTER TABLE document_embeddings ALTER COLUMN embedding TYPE vector(512);`
    - Opción B (Híbrida): Añadir columna `embedding_jina vector(512)`. **(Recomendado: Opción A para limpieza, dado que re-indexaremos todo).**
- [ ] Actualizar índices HNSW/IVFFLAT para la nueva columna.

---

## 4. Fase 4: La Capa de Refinamiento (Cohere Rerank)

**Problema Actual:** La búsqueda vectorial (ANN) trae "vecinos cercanos" en el espacio vectorial que a veces no son semánticamente relevantes para la pregunta específica.

**Solución:** Two-stage retrieval.

### Tareas de Implementación
- [ ] Actualizar lógica de búsqueda en `src/lib/quoth/search.ts`:
    1.  **Stage 1 (Supabase)**: Recuperar **50** candidatos (antes 10) usando similitud coseno.
    2.  **Stage 2 (Cohere)**: Enviar `(query, documents)` al endpoint `/rerank`.
        - Modelo: `rerank-english-v3.0` (o multilingual si es necesario).
    3.  **Filtrado**: Tomar los Top 10 con `relevance_score > 0.5`.
- [ ] Instalar/Configurar SDK de Cohere (`npm install cohere-ai` ya realizado).

---

## 5. Fase 5: Integración y Despliegue

**Objetivo:** Conectar todo y re-indexar la base de conocimiento existente.

### Tareas de Implementación
- [ ] Script de Re-indexado masivo:
    - Leer todos los documentos de `documents`.
    - Re-chunkear con AST.
    - Generar nuevos embeddings Jina.
    - Guardar en Supabase.
- [ ] Actualizar herramientas MCP (`tools.ts`) para exponer la nueva lógica de búsqueda.
- [ ] Pruebas de verificación:
    - Búsqueda de concepto abstracto ("pattern de inyección de dependencias").
    - Búsqueda de código específico ("función searchDocuments").

---

## Consideraciones "0 Overengineering"

1.  **Sin Infraestructura Extra**: No desplegaremos contenedores de Weaviate/Qdrant. Usamos Supabase (Postgres) que ya tenemos.
2.  **No Custom Training**: Usamos modelos off-the-shelf (Jina, Cohere) vía API.
3.  **Lógica Simple**: El chunking AST será "best effort" para los lenguajes principales (TS/JS), con fallback robusto a texto plano.
