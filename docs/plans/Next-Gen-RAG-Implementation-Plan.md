# Plan de Implementación: Sistema RAG de Próxima Generación

**Estado:** ✅ Implementado (Enero 2026)
**Fecha:** Enero 2026
**Última Actualización:** 12 Enero 2026 - AST Chunking funcionando con WASM auto-construidos
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
- [x] Crear módulo `src/lib/quoth/chunking.ts`:
    - Carga dinámica de gramáticas WASM (usando `public/wasm/` con WASM auto-construidos vía `tree-sitter-cli`).
    - Multi-path resolution para compatibilidad Vercel + desarrollo local.
    - Estrategia de recorrido de árbol para extraer: `FunctionDeclaration`, `ClassDeclaration`, `MethodDefinition`, `export_statement`, `interface_declaration`, `type_alias_declaration`.
    - Preservación de comentarios/JSDoc precedentes.
- [x] Integrar en `sync.ts`:
    - `astChunker.chunkFile` como punto de entrada principal.
    - Fallback robusto a text-based chunking para markdown y archivos no soportados.
- [x] Script `setup:wasm` para construir WASM compatibles con `tree-sitter-cli`.

---

## 2. Fase 2: Especialización de Embeddings (Jina v3)

**Problema Actual:** `text-embedding-004` de Google es bueno para prosa general, pero mediocre para código y mixed-context.

**Solución:** Integrar API de Jina AI.

### Tareas de Implementación
- [x] Actualizar `src/lib/ai.ts`:
    - Implementar `generateJinaEmbedding(text: string)`.
    - Endpoint: `https://api.jina.ai/v1/embeddings`.
    - Modelo: `jina-embeddings-v3`.
    - Headers: `Authorization: Bearer ${JINA_API_KEY}`.
- [x] Manejo de Dimensiones:
    - Solicitar 512 dimensiones (Matryoshka) para eficiencia en DB.
    - Fallback a Gemini `text-embedding-004` si Jina no está disponible.

---

## 3. Fase 3: Migración de Base de Datos (Supabase)

**Problema Actual:** La tabla `document_embeddings` usa vectores de 768 dimensiones (Google) o 1536 (OpenAI). Jina v3 estándar es 1024, pero usaremos 512.

**Solución:** Migración de esquema.

### Tareas de Implementación
- [x] Crear migración SQL (`supabase/migrations/018_update_vector_size.sql`):
    - Opción A (Destructiva) aplicada: `TRUNCATE document_embeddings; ALTER TABLE document_embeddings ALTER COLUMN embedding TYPE vector(512);`
- [x] Actualizar índices HNSW para la nueva columna (m=16, ef_construction=64).

---

## 4. Fase 4: La Capa de Refinamiento (Cohere Rerank)

**Problema Actual:** La búsqueda vectorial (ANN) trae "vecinos cercanos" en el espacio vectorial que a veces no son semánticamente relevantes para la pregunta específica.

**Solución:** Two-stage retrieval.

### Tareas de Implementación
- [x] Actualizar lógica de búsqueda en `src/lib/quoth/search.ts`:
    1.  **Stage 1 (Supabase)**: Recuperar **50** candidatos usando similitud coseno.
    2.  **Stage 2 (Cohere)**: Enviar `(query, documents)` al endpoint `/rerank`.
        - Modelo: `rerank-english-v3.0`.
    3.  **Filtrado**: Tomar los Top 15 con `relevance_score > 0.5`.
- [x] SDK de Cohere instalado y configurado (`cohere-ai` ^7.20.0).

---

## 5. Fase 5: Integración y Despliegue

**Objetivo:** Conectar todo y re-indexar la base de conocimiento existente.

### Tareas de Implementación
- [x] Script de Re-indexado masivo (`npm run reindex`):
    - Leer todos los documentos de `documents`.
    - Re-chunkear con AST.
    - Generar nuevos embeddings Jina (512 dims).
    - Guardar en Supabase con incremental hashing.
- [x] Herramientas MCP actualizadas en `tools.ts` con nueva lógica de búsqueda.
- [x] Script de verificación (`npm run verify:rag`):
    - Verifica inicialización AST.
    - Verifica embeddings Jina 512 dimensiones.
- [ ] **Pendiente**: Ejecutar reindex en producción después de deploy.

---

## Consideraciones "0 Overengineering"

1.  **Sin Infraestructura Extra**: No desplegaremos contenedores de Weaviate/Qdrant. Usamos Supabase (Postgres) que ya tenemos.
2.  **No Custom Training**: Usamos modelos off-the-shelf (Jina, Cohere) vía API.
3.  **Lógica Simple**: El chunking AST será "best effort" para los lenguajes principales (TS/JS/Python), con fallback robusto a texto plano.

---

## Notas de Implementación

### Fix: WASM en Vercel Serverless (12 Enero 2026)

El paquete `tree-sitter-wasms` resultó incompatible con `web-tree-sitter` v0.26.3 debido a diferencias en el formato dylink de los WASM.

**Solución implementada:**
1. **Auto-construcción de WASM**: Usar `tree-sitter-cli` para construir WASM compatibles localmente
2. **Almacenamiento en `public/wasm/`**: Los archivos WASM se guardan en el directorio público
3. **Multi-path resolution**: El código busca WASM en múltiples ubicaciones (local + Vercel)
4. **`outputFileTracingIncludes`**: Next.js 16 incluye los WASM en el bundle de serverless

**Comandos relevantes:**
```bash
npm run setup:wasm    # Construir/verificar WASM files
npm run verify:rag    # Verificar pipeline completo
npm run reindex       # Re-indexar documentos
```

**Archivos WASM requeridos (en `public/wasm/`):**
- `web-tree-sitter.wasm` (copiado de node_modules)
- `tree-sitter-typescript.wasm` (construido)
- `tree-sitter-javascript.wasm` (construido)
- `tree-sitter-python.wasm` (construido)
