program Repro;
type
  TPacked = packed record
    a: 0..3;
    b: Boolean;
  end;
  TBase = class abstract(TObject)
    class var Count: Integer;
  end;
  TDigit = 0..9;
procedure Test;
label 1;
begin
  goto 1;
1:
  WriteLn;
end;
begin
end.