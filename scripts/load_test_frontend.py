import time
import statistics
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor

TARGET_URL = "http://localhost:3000"
TOTAL_REQUESTS = 1000
CONCURRENT_USERS = 50

def make_request(_):
    start = time.perf_counter()
    try:
        req = urllib.request.Request(TARGET_URL)
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.getcode()
            duration = (time.perf_counter() - start) * 1000.0
            return status, duration, None
    except urllib.error.HTTPError as e:
        duration = (time.perf_counter() - start) * 1000.0
        return e.code, duration, None
    except Exception as e:
        duration = (time.perf_counter() - start) * 1000.0
        return 500, duration, str(e)

def run_benchmark():
    print(f"=== INICIANDO TESTE DE FOGO DO FRONTEND NGINX ===")
    print(f"Alvo: {TARGET_URL}")
    print(f"Total de Requisicoes: {TOTAL_REQUESTS}")
    print(f"Usuarios Concorrentes Simultaneos: {CONCURRENT_USERS}")
    print("-" * 60)

    start_total = time.perf_counter()
    
    with ThreadPoolExecutor(max_workers=CONCURRENT_USERS) as executor:
        results = list(executor.map(make_request, range(TOTAL_REQUESTS)))

    total_time = time.perf_counter() - start_total

    durations = [r[1] for r in results]
    statuses = [r[0] for r in results]

    durations.sort()
    p50 = statistics.median(durations)
    p90 = durations[int(len(durations) * 0.90)]
    p99 = durations[int(len(durations) * 0.99)]
    avg = statistics.mean(durations)
    min_lat = min(durations)
    max_lat = max(durations)
    rps = TOTAL_REQUESTS / total_time
    success_count = sum(1 for s in statuses if s == 200)

    print(f"\n=== RESULTADOS DO TESTE DE FOGO (FRONTEND NGINX) ===")
    print(f"Tempo Total do Teste: {total_time:.2f}s")
    print(f"Requisicoes por Segundo (RPS): {rps:.2f} req/s")
    print(f"Latencia Media: {avg:.2f} ms")
    print(f"Latencia Minima: {min_lat:.2f} ms")
    print(f"Latencia Maxima: {max_lat:.2f} ms")
    print(f"Latencia P50 (Mediana): {p50:.2f} ms")
    print(f"Latencia P90 (90% dos usuarios): {p90:.2f} ms")
    print(f"Latencia P99 (99% dos usuarios): {p99:.2f} ms")
    print(f"Taxa de Sucesso: {success_count}/{TOTAL_REQUESTS} ({success_count/TOTAL_REQUESTS*100:.1f}%)")
    print("=" * 60)

if __name__ == "__main__":
    run_benchmark()
