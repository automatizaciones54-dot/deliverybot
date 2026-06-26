import sys
sys.stdout.reconfigure(encoding='utf-8')
from validador import *
from ges_diccionario import DICCIONARIO_GES

print("=== 1. IMPORTACIONES ===")
print("validador: OK")
print("DICCIONARIO_GES: %d palabras" % len(DICCIONARIO_GES))

print()
print("=== 2. CARGA DE CONFIG GES ===")
c = cargar_config(perfil="ges")
print("perfil: %s" % c.get("perfil"))
print("editorial: %s" % c.get("editorial"))
print("color: %s" % c.get("reportes",{}).get("color_primario"))
print("reglas texto_escolar: %s" % c.get("reglas",{}).get("texto_escolar",{}))

print()
print("=== 3. CARGA DE PALABRAS USUARIO GES ===")
p = cargar_palabras_usuario(perfil="ges")
print("total palabras: %d" % len(p))
for term in ["eli guardia", "delia saldias", "camba", "saltena", "multitexto", "pachamama", "illimani"]:
    ok = any(term.replace("i","i").replace("a","a") in w.replace("i","i").replace("a","a") for w in p)
    print("  %s %s" % ("OK" if ok else "FAIL", term))

print()
print("=== 4. PRUEBA DE CORRECCION COMPLETA ===")
texto_prueba = "La celula y el nucleo. La fotosintesis. Los atomos y moleculas."
base = DICCIONARIO_ACENTOS.copy()
base.update(DICCIONARIO_GES)
DICCIONARIO_ACENTOS.clear()
DICCIONARIO_ACENTOS.update(base)

v = ValidadorEditorial(texto_prueba, c, p, perfil="ges")
errores = v.validar_y_corregir()
print("errores detectados: %d" % len(errores))
for e in errores:
    print('  L%d: "%s" -> "%s" [%s]' % (e["linea"], e["original"], e["corregido"], e["tipo"]))
print('texto corregido: "%s"' % v.texto_corregido)

print()
print("=== 5. CLASIFICACION DE ERRORES ===")
print("  Ortograficos: %d" % v.estadisticas.get("errores_ortograficos",0))
print("  Tipograficos: %d" % v.estadisticas.get("errores_tipograficos",0))
print("  Gramaticales: %d" % v.estadisticas.get("errores_gramaticales",0))
print("  Estilo: %d" % v.estadisticas.get("errores_estilo",0))

print()
print("=== 6. REGLA DE UNIDADES DE MEDIDA ===")
texto_uni = "Recorre 50km en 3h con 25kg de carga a 100m de altura."
v2 = ValidadorEditorial(texto_uni, c, p, perfil="ges")
v2.config["reglas"]["texto_escolar"]["unidades_medida"] = True
err2 = v2.validar_y_corregir()
uni_err = [e for e in err2 if e["subtipo"] == "Unidad sin espacio"]
print("errores de unidades: %d" % len(uni_err))
for e in uni_err:
    print('  "%s" -> "%s"' % (e["original"], e["corregido"]))

print()
print("=== 7. PRUEBA DE REPETIDAS ===")
texto_rep = "El el perro corre corre rapido."
v3 = ValidadorEditorial(texto_rep, c, p)
err3 = v3.validar_y_corregir()
repetidas = [e for e in err3 if e["subtipo"] == "Palabra repetida"]
print("repetidas detectadas: %d" % len(repetidas))
for e in repetidas:
    print('  "%s"' % e["original"])

print()
print("=== 8. GRAMATICA AVANZADA ===")
texto_gram = "tubo que ir al colegio. a echo la tarea. ayan terminado."
v4 = ValidadorEditorial(texto_gram, c, p)
err4 = v4.validar_y_corregir()
print("errores gramaticales: %d" % len(err4))
for e in err4:
    print('  "%s" -> "%s" [%s]' % (e["original"], e["corregido"], e["subtipo"]))

print()
print("=== 9. REGIONALISMOS BOLIVIANOS ===")
DICCIONARIO_ACENTOS.clear()
DICCIONARIO_ACENTOS.update(base)
texto_bol = "La saltena es tipica de Santa Cruz. El majadito es un plato tipico."
v5 = ValidadorEditorial(texto_bol, c, p)
err5 = v5.validar_y_corregir()
ortos = [e for e in err5 if e["subtipo"] in ("Acento faltante (spellchecker)", "Correccion ortografica", "Acento cientifico faltante", "Acento faltante")]
print("errores en texto boliviano: %d total, %d ortograficos" % (len(err5), len(ortos)))
for e in err5:
    print('  "%s" -> [%s]' % (e["original"], e["subtipo"]))

print()
print("=== 10. TODAS LAS PRUEBAS COMPLETADAS ===")
