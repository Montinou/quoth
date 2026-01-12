# **Plan de Implementación para un Sistema de RAG Técnico Avanzado**

Este documento detalla la transición desde un sistema de recuperación básica hacia una arquitectura optimizada para documentación técnica y código fuente, basada en los estándares de enero de 2026\.

## **Introducción al Cambio de Paradigma**

La mayoría de los sistemas actuales utilizan un enfoque de RAG ingenuo donde el texto se divide en fragmentos de tamaño fijo y se busca mediante modelos de propósito general. Para documentación técnica, este enfoque es insuficiente. La nueva estrategia se centra en la integridad estructural del código, el re-posicionamiento de relevancia (reranking) y el uso de modelos especializados que entienden la sintaxis de programación mejor que los modelos lingüísticos estándar.

## **Fase 1: Ingesta Estructural mediante AST Chunking**

La base de una buena respuesta es una buena recuperación, y la base de una buena recuperación es cómo se dividen los datos inicialmente.

En lugar de usar un "RecursiveCharacterTextSplitter" que corta el texto arbitrariamente, se debe implementar un splitter basado en Árboles de Sintaxis Abstracta (AST) utilizando la biblioteca Tree-sitter. Esto permite que el sistema identifique dónde empieza y termina una función, una clase o un método.

Al tratar cada entidad de código como una unidad lógica completa, evitamos que el modelo de embeddings reciba fragmentos de código truncados que carecen de contexto semántico. Esto garantiza que, cuando el usuario pregunte por una función específica, el sistema recupere el bloque de código entero junto con sus comentarios asociados.

## **Fase 2: Especialización Semántica con Jina Embeddings v3**

El modelo actual de Google es excelente para lenguaje natural, pero carece del entrenamiento específico en grafos de dependencia de software que tienen los modelos de última generación.

Se propone la migración a Jina Embeddings v3. Este modelo ofrece una ventaja crítica: el soporte para Late Chunking. Esta técnica permite al modelo procesar el documento completo antes de generar los vectores de los fragmentos, lo que significa que cada vector de un fragmento de código "conoce" el contexto global del archivo al que pertenece.

Desde el punto de vista económico, Jina ofrece un nivel gratuito de 10 millones de tokens, lo cual es más que suficiente para indexar múltiples versiones de una documentación técnica extensa sin incurrir en costos.

## **Fase 3: Almacenamiento Optimizado en Supabase**

Para no complicar la infraestructura, mantendremos Supabase y su extensión pgvector, pero optimizaremos la forma en que guardamos los datos mediante el aprendizaje de representación Matryoshka (MRL).

MRL nos permite generar vectores de alta dimensionalidad (como 3072\) pero almacenarlos y realizar búsquedas utilizando solo una fracción de ellos (por ejemplo, 512 dimensiones). Esto reduce el uso de memoria en Supabase y acelera las búsquedas vectoriales de forma masiva, manteniendo más del 90% de la precisión original del modelo.

## **Fase 4: La Capa de Refinamiento con Cohere Rerank 3.5**

Este es el paso más importante para mejorar la calidad del resultado final. La búsqueda vectorial a menudo devuelve resultados que son similares en palabras pero irrelevantes en concepto.

El proceso de Reranking actúa como un segundo filtro mucho más inteligente. Una vez que Supabase devuelve los 20 resultados más cercanos, estos se envían al modelo Rerank 3.5 de Cohere. Este modelo no busca similitud de vectores, sino que realiza un análisis profundo de la relevancia entre la pregunta del usuario y el contenido del fragmento.

Cohere ofrece una llave de prueba con 1,000 solicitudes gratuitas por mes, lo que permite implementar esta tecnología líder en la industria en etapas de desarrollo y producción temprana sin costo alguno.

## **Fase 5: Generación de Respuestas con Gemini 2.5 Flash**

Para la etapa final de generación, seguiremos utilizando el ecosistema de Google a través de Gemini 2.5 Flash en AI Studio.

La ventaja competitiva aquí no es solo la rapidez, sino su ventana de contexto de un millón de tokens. Esto nos permite enviar no solo los fragmentos recuperados, sino también ejemplos de estilo de codificación de la empresa, reglas de arquitectura y el historial completo de la conversación sin temor a perder información.

Al usar la API de Google AI Studio, los límites del nivel gratuito son extremadamente generosos para sistemas de documentación interna o herramientas para desarrolladores en fase de crecimiento.

## **Consideraciones sobre el Futuro: GraphRAG y MCP**

A medida que el sistema escale, el plan contempla dos evoluciones adicionales. Primero, la implementación de GraphRAG para preguntas que requieren entender relaciones complejas entre módulos distribuidos en diferentes archivos. Segundo, la integración con el Model Context Protocol (MCP), lo que permitiría que herramientas como Claude Desktop o cursores de IDE lean esta documentación directamente desde la infraestructura de la aplicación, eliminando intermediarios y mejorando la experiencia del desarrollador.

Este plan representa un equilibrio entre el estado del arte tecnológico y la viabilidad económica, asegurando que cada componente aporte un valor real a la precisión de las respuestas entregadas al usuario final.