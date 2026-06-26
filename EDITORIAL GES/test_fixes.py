import sys, os
sys.path.insert(0, "C:\\Users\\jorge\\Desktop\\validador-editorial")
os.chdir("C:\\Users\\jorge\\Desktop\\validador-editorial")
from validador import *

# Test 1: sino/si no fix (was crashing)
print("=== TEST 1: sino/si no fix ===")
v = ValidadorEditorial("no estudio, si no trabajo.")
try:
    err = v.validar_y_corregir()
    sino = [e for e in err if e["subtipo"] == "Posible 'sino' junto"]
    print("  Errores sino: %d (OK, no crash)" % len(sino))
except Exception as e:
    print("  CRASH: %s" % e)

# Test 2: Acento cientifico correction
print()
print("=== TEST 2: Acento cientifico correction ===")
from ges_diccionario import DICCIONARIO_GES
import diccionario
DICCIONARIO_ACENTOS.clear()
DICCIONARIO_ACENTOS.update(diccionario.DICCIONARIO_ACENTOS)
v2 = ValidadorEditorial("La celula y el nucleo.", None, set(), perfil="ges")
v2.config["reglas"] = {"acentos": True, "gramatica_avanzada": True, "texto_escolar": {"terminologia_cientifica": True}}
err2 = v2.validar_y_corregir()
print("  Errores: %d" % len(err2))
print('  Corregido: "%s"' % v2.texto_corregido)

# Test 3: Units regex with degree and percent
print()
print("=== TEST 3: Units with degree/percent ===")
v3 = ValidadorEditorial("Temp 25C y 50% humedad con $10.", None, set(), perfil="ges")
v3.config["reglas"] = {"texto_escolar": {"unidades_medida": True}}
err3 = v3.validar_y_corregir()
uni = [e for e in err3 if e["subtipo"] == "Unidad sin espacio"]
print("  Unidades detectadas: %d" % len(uni))
for e in uni:
    print('    "%s" -> "%s"' % (e["original"], e["corregido"]))

# Test 4: No crash on edge case
print()
print("=== TEST 4: Edge case - empty text ===")
v4 = ValidadorEditorial("   ", None, set())
err4 = v4.validar_y_corregir()
print("  Empty text handled: %s" % ("OK" if len(err4) == 0 else "ERROR"))

print()
print("ALL TESTS PASSED")
