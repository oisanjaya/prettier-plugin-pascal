library StringUtils;
{$mode objfpc}
{$H+}
uses
  SysUtils;
function ToUpperC(strIn: PChar): PChar;  cdecl;
begin
  Result := PChar(UpperCase(strIn));
end;
exports
  ToUpperC;
begin
end.
