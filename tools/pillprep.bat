@echo off
rem Drag a folder of pill photos (named brand + dose) onto this file.
rem First run installs the background remover (rembg) if it is missing.
py -c "import rembg" 2>nul || py -m pip install "rembg[cpu]" pillow
py "%~dp0pillprep.py" %*
pause
