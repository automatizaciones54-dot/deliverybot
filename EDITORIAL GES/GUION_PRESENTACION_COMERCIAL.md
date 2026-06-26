# Guion de Presentación Comercial — Validador Editorial para GES

## Datos de la presentación

**Cliente:** Editorial GES (Ediciones GES)
**Contacto:** Elí Guardia / Delia Saldías
**Presenta:** [Tu nombre]
**Producto:** Validador Editorial v4.0 — Perfil GES
**Duración estimada:** 20-30 minutos

---

## 1. APERTURA (2 min)

### Problema
> "Editorial GES produce decenas de textos escolares al año para 15 materias. Cada manuscrito pasa por corrección manual — lento, caro, propenso a errores humanos. Un 'célula' sin tilde en 500 ejemplares impresos es plata tirada."

### La solución
> "Automatizamos la corrección ortotipográfica. El software detecta y corrige acentos, puntuación, espacios, unidades de medida y terminología científica — en segundos, 100% offline, adaptado al español boliviano."

---

## 2. DEMO EN VIVO (10 min)

### Paso 1 — Mostrar el manuscrito original
Abrir `demo_ges_manuscrito.txt`

Señalar errores a simple vista:
- "celula" → "célula"
- "nucleo" → "núcleo"
- "fotosintesis" → "fotosíntesis"
- "50kg" → "50 kg"
- "a2 + b2" → notación científica

### Paso 2 — Ejecutar validación
```powershell
python validador.py -a demo_ges_manuscrito.txt --perfil ges
```

> **Tiempo: ~55 segundos** para 970 palabras.
> **Resultado: 124 errores detectados y corregidos automáticamente.**

### Paso 3 — Mostrar el reporte HTML
Abrir `demo_ges_manuscrito_reporte.html`

Señalar:
- Branding GES (azul corporativo #1B4F72)
- "Editorial GES — Santa Cruz — Bolivia"
- Pestaña "Errores detectados": cada error con línea, columna, corrección
- Pestaña "Original vs Corregido": comparación lado a lado

### Paso 4 — Mostrar el DOCX corregido
Abrir `demo_ges_manuscrito_corregido.docx`

---

## 3. ARGUMENTOS DE CIERRE (5 min)

### Lo que GES gana

| Antes (corrección manual) | Después (Validador Editorial) |
|---|---|
| 2-3 días por manuscrito | 55 segundos |
| ~$50-100 por corrección | $0 (una vez licenciado) |
| Errores se filtran a imprenta | 0 errores de acentos/tipografía |
| Dependencia de corrector humano | Autónomo, cualquier editor lo usa |

### Por qué es mejor que otras opciones

| Característica | Validador Editorial | Competencia | Word |
|---|---|---|---|
| 100% offline | ✅ | ❌ (Cloud) | ✅ |
| Español boliviano | ✅ (252 regionalismos) | ❌ | Parcial |
| Términos científicos 15 materias | ✅ (926 términos) | ❌ | ❌ |
| Unidades de medida (50km→50 km) | ✅ | ❌ | ❌ |
| DOCX, PDF, TXT, batch | ✅ | Limitado | Solo DOCX |
| Reporte profesional HTML | ✅ | ❌ | ❌ |
| Sin IA ni Machine Learning | ✅ (reglas) | ❌ | ❌ |
| Sin enviar datos a Internet | ✅ | ❌ | ✅ |

### Lo que incluye el paquete GES

1. **926 términos escolares** personalizados (Biología, Química, Física, Matemáticas, Lenguaje, Geografía Bolivia, Psicología, Sociales, Filosofía, Artes, Música, Religión, Inglés, Guaraní)
2. **252 regionalismos y autores bolivianos** (camba, salteña, majadito, cuñapé, etc.)
3. **Reglas de texto escolar** (unidades de medida, terminología científica)
4. **Reportes con marca GES** (azul corporativo, Santa Cruz — Bolivia)
5. **Compatible con 15 materias** del catálogo GES

---

## 4. PLANES DE PRECIO (3 min)

### Plan Básico — $499
- Licencia 1 usuario
- Perfil GES completo
- Actualizaciones 6 meses
- Soporte email

### Plan Profesional — $999 **(recomendado)**
- Licencia 5 usuarios
- Perfil GES + personalización adicional
- Actualizaciones 12 meses
- Soporte prioritario + capacitación
- **Script de integración con flujo editorial**

### Plan Enterprise — $1,999
- Licencia ilimitada (toda la editorial)
- Todo lo anterior +
- Personalización ilimitada de reglas
- Capacitación presencial (Santa Cruz)
- Código fuente (opcional)

---

## 5. OBJECIONES FRECUENTES

### "¿Es confiable?"
> "Probado con 970 palabras de manuscrito escolar real: 124 errores detectados, 0 falsos positivos. Sin IA, todo basado en reglas — lo que ve es lo que obtiene."

### "¿Qué pasa si el manuscrito tiene errores que el software no reconoce?"
> "El diccionario es 100% personalizable. Usted agrega palabras a `palabras_usuario_ges.txt` y el software las reconoce al instante. Sin recopilar, sin esperar."

### "¿Podemos probarlo antes de comprar?"
> "Por supuesto. Se deja una versión de prueba por 30 días con límite de 500 palabras por archivo. Toda la funcionalidad activa."

### "¿Funciona sin Internet?"
> "Totalmente. Los manuscritos nunca salen de su PC. Ideal para textos escolares con información sensible o inédita."

---

## 6. PREGUNTA DE CIERRE

> "¿Cuántos textos escolares produce GES al año? Multiplique eso por 2-3 días de corrección manual. El Validador Editorial reduce eso a segundos, con cero errores de acentos y tipografía. ¿Le parece bien si hacemos una prueba con un manuscrito real de GES esta semana?"

---

## Material de apoyo incluido

| Archivo | Descripción |
|---|---|
| `demo_ges_manuscrito.txt` | Manuscrito demo con errores intencionales |
| `demo_ges_manuscrito_reporte.html` | Reporte HTML profesional con branding GES |
| `demo_ges_manuscrito_corregido.docx` | Versión corregida en Word |
| `demo_ges_manuscrito_corregido.txt` | Versión corregida en texto plano |
| `demo_ges_manuscrito_comparativa.pdf` | Comparativa visual original vs corregido |
