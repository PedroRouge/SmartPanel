from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import socket
import threading

# Función rápida para buscar dispositivos Onn / Android TV / Cast en la red local
def scan_local_tvs():
    found_devices = []
    # Rango de IPs de tu red local (asumiendo 192.168.0.x)
    # Escaneamos del 1 al 254 buscando el puerto 8008 (Google Cast / Android TV / Onn)
    base_ip = "192.168.0."
    
    def check_ip(ip):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.3) # Timeout ultra rápido para que no tarde nada
            result = s.connect_ex((ip, 8008))
            if result == 0:
                found_devices.append({
                    "id": ip,
                    "name": f"Dispositivo Cast / Onn ({ip})",
                    "ip": ip,
                    "state": "on",
                    "source": "auto-detect"
                })
            s.close()
        except:
            pass

    threads = []
    for i in range(1, 255):
        ip = f"{base_ip}{i}"
        t = threading.Thread(target=check_ip, args=(ip,))
        threads.append(t)
        t.start()
        
    for t in threads:
        t.join()
        
    return found_devices

class SmartPanelHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/tvs':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            # Escanea la red y devuelve las teles/Onn encontradas
            devices = scan_local_tvs()
            
            # Si no encuentra ninguna por el escaneo rápido, manda un fallback para que no quede vacío
            if not devices:
                devices = [
                    {"id": "fallback-1", "name": "Living TV (Simulada)", "ip": "192.168.0.x", "state": "off"}
                ]
                
            self.wfile.write(json.dumps(devices).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def run(server_class=HTTPServer, handler_class=SmartPanelHandler, port=5000):
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print(f"Servidor API local corriendo en puerto {port}...")
    httpd.serve_forever()

if __name__ == '__main__':
    run()