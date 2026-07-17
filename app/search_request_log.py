# Let's read request_log.txt and print lines containing /pdv/
with open("app/request_log.txt", "r") as f:
    lines = f.readlines()

print(f"Total lines in request_log: {len(lines)}")
pdv_lines = [line for line in lines if "/pdv/" in line or "/pdv " in line]
print(f"Total lines with pdv: {len(pdv_lines)}")

print("\nLast 50 pdv requests in log:")
for line in pdv_lines[-50:]:
    print(line.strip())
