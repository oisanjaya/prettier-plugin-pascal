program RaiseTest;
{$mode objfpc}
uses
  SysUtils;
var
  E: Exception;
begin
  E := Exception.Create('err');
  try
    raise E;
  except
    E.Free;
  end;
end.
