program WithTest;
type
  TObj = record
      Value: Integer;
    end;
var
  Obj: TObj;
begin
  with Obj do Value := 1;
end.
