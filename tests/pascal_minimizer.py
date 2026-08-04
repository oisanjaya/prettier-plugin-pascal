import sys
import os
import re

def minimize_pascal(content):
    """
    Minimizes Pascal code according to the specified rules:
    1. Replaces all whitespaces (including newlines) with a single space.
    2. Removes whitespaces around commas (,), semi-colons (;), dots (.), and colons (:).
    3. Preserves string literals and safely handles inline/block comments.
    4. Inserts new lines when a line ends with a colon, or around curly braces.
    """
    # We split by Pascal string literals and comments.
    # This prevents the script from accidentally removing spaces inside strings
    # or breaking the syntax when encountering comments (like //).
    # - ('(?:''|[^'])*') : matches string literals, accounting for escaped quotes ('')
    # - (\{.*?\}) : matches block comments {...}
    # - (\(\*.*?\*\)) : matches block comments (*...*)
    # - (//[^\n]*) : matches inline comments //...
    pattern = re.compile(r"('(?:''|[^'])*'|\{.*?\}|\(\*.*?\*\)|//[^\n]*)", flags=re.DOTALL)
    parts = re.split(pattern, content)
    
    minimized_parts = []
    
    for i, part in enumerate(parts):
        if i % 2 == 1:
            # This part is a string literal or a comment
            if part.startswith("'"):
                # String literal, append exactly as is
                minimized_parts.append(part)
            elif part.startswith("{"):
                # Insert new lines around curly braces
                modified_part = part.replace("{", "\n{\n").replace("}", "\n}\n")
                minimized_parts.append(modified_part)
            else:
                # Comment: append exactly, but ensure a newline follows
                # so that inline comments don't consume subsequent code
                minimized_parts.append(part + '\n')
        else:
            # This part is Pascal code, apply the minimization rules
            if not part:
                continue
                
            # Mark colons at the end of a line (disregarding trailing spaces)
            # to ensure we insert/preserve a newline after them
            part = re.sub(r':[ \t]*\r?\n', ':__PASCAL_MINIMIZER_COLON_NEWLINE__', part)
            
            # Rule 1: Replace multiple consecutive whitespaces (including newlines) 
            # with a single space character
            code = re.sub(r'\s+', ' ', part)
            
            # Rule 2: Remove whitespaces around comma, semi-colon, dot, and colon
            code = re.sub(r'\s*([,;.:])\s*', r'\1', code)
            
            # Restore the newlines after colons
            code = code.replace(':__PASCAL_MINIMIZER_COLON_NEWLINE__', ':\n')
            
            # Also ensure any curly braces parsed as code get newlines around them
            code = code.replace('{', '\n{\n').replace('}', '\n}\n')
            
            minimized_parts.append(code)
            
    # Join everything back together
    joined_content = "".join(minimized_parts)
    
    trimmed_lines = [line.lstrip() for line in joined_content.splitlines()]
    
    return "\n".join(trimmed_lines).strip()

def main():
    if len(sys.argv) < 2:
        print("Usage: python pascal_minimizer.py <input_file.pas>")
        sys.exit(1)
        
    input_file = sys.argv[1]
    
    if not os.path.exists(input_file):
        print(f"Error: File '{input_file}' not found.")
        sys.exit(1)
        
    # Read the original file
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # Minimize the content
    minimized_content = minimize_pascal(content)
    
    # Get the original file name and extension
    base_name, ext = os.path.splitext(input_file)
    
    # Create the two output filenames
    out_file1 = f"{base_name}_1{ext}"
    out_file2 = f"{base_name}_2{ext}"
    
    # Write the identical minimized content to both files
    with open(out_file1, 'w', encoding='utf-8') as f:
        f.write(minimized_content)
        
    with open(out_file2, 'w', encoding='utf-8') as f:
        f.write(minimized_content)
        
    print("Pascal file minimized successfully!")
    print(f"Generated output files:\n 1. {out_file1}\n 2. {out_file2}")

if __name__ == "__main__":
    main()