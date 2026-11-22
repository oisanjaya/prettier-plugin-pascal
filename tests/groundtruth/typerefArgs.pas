program TyperefArgsTest;
{$mode objfpc}
type
  generic TPair<T1, T2> = record
      A: T1;
      B: T2;
    end;
var
  x: specialize TPair<Integer, String>;
begin
end.
