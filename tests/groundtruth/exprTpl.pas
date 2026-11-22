program ExprTplTest;
{$mode objfpc}
generic function Foo<T>(A: T): T;
begin
  Result := A;
end;
var
  x: Integer;
begin
  x := specialize Foo<Integer>(1);
end.
