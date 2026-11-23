# Administrador psicoanalítico

App instalable (PWA) para Android. Agenda, pacientes, cuentas y material de sesiones.

**Privacidad:** este repositorio contiene solo el programa. Los datos (pacientes, cuentas, audios, escritos)
se guardan únicamente en el teléfono, cifrados con AES-256-GCM. La clave se protege con la contraseña
del usuario (PBKDF2, 600.000 iteraciones). La app no se conecta a ningún servidor
(Content-Security-Policy `connect-src 'self'`). Los respaldos son archivos cifrados con la misma contraseña.
