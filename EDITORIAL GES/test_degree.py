import sys
sys.path.insert(0, "C:\\Users\\jorge\\Desktop\\validador-editorial")
from validador import *
v = ValidadorEditorial("Temperatura 25°C y 100°F.", None, set(), perfil="ges")
v.config["reglas"] = {"texto_escolar": {"unidades_medida": True}}
err = v.validar_y_corregir()
for e in err:
    if e["subtipo"] == "Unidad sin espacio":
        print('  "%s" -> "%s"' % (e["original"], e["corregido"]))
print("Total unidades: %d" % len([e for e in err if e["subtipo"] == "Unidad sin espacio"]))
